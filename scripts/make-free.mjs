#!/usr/bin/env node
/**
 * make-free.mjs — 从私库（本仓）裁剪生成"免费版"孤儿提交，供推送到公开仓 ai-quote-free。
 *
 * 用法：
 *   node scripts/make-free.mjs             仅在本地生成 free-release 分支（不推送）
 *   node scripts/make-free.mjs --push      生成后推送 free-release:main 到远程 free
 *   node scripts/make-free.mjs --push --tag v1.2.1 [--notes-file notes.txt]
 *                                          推送后在公开仓打附注 tag（消息取自 --notes-file，未提供则询问）
 *
 * 原理：
 *   1. 在临时目录建一个 HEAD 的 git worktree，在其中做裁剪，不触碰当前工作区。
 *   2. 删除授权模块等私有资产（固定文件清单）。
 *   3. 全仓扫描剥离源码中的 // @premium-start .. // @premium-end
 *      （以及 {/* @premium-start *\/} 与 # @premium-start 两种注释风格）标记块。
 *   4. 对若干无法用标记表达的差异（更新源仓库名、README、帮助文案）做精确字符串替换。
 *   5. 敏感信息与残留扫描，未通过则中止。
 *   6. 在 worktree 内跑测试与 typecheck（node_modules 软链到本仓，加快安装）。
 *   7. 生成一个孤儿提交（无父提交），分支名 free-release。
 *   8. --push 时推送到 https://github.com/baotangyin/ai-quote-free.git（远程名 free）。
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync,
  symlinkSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------
// 1. 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { push: false, tag: null, notesFile: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--push') args.push = true;
    else if (token === '--tag') args.tag = argv[++i];
    else if (token === '--notes-file') args.notesFile = argv[++i];
    else {
      console.error(`未知参数：${token}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------------------------

function git(gitArgs, opts = {}) {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}

function gitIn(cwd, gitArgs, opts = {}) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', ...opts });
}

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

/** 递归列出目录下所有文件（跳过指定的目录名/相对路径）。 */
function listFiles(root, { skipDirs = [], skipPaths = [] } = {}) {
  const result = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (skipPaths.includes(rel)) continue;
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  }
  walk(root);
  return result;
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml',
  '.css', '.html', '.txt', '.gitignore',
]);

function isTextFile(filePath) {
  const ext = path.extname(filePath);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (path.basename(filePath) === '.gitignore') return true;
  return false;
}

// ---------------------------------------------------------------------------
// 3. 前置检查：工作树必须干净
// ---------------------------------------------------------------------------

const dirty = git(['status', '--porcelain']).trim();
if (dirty) {
  fail('当前工作区有未提交的改动，请先 commit 或 stash 后再执行本脚本。');
}

const headSha = git(['rev-parse', '--short', 'HEAD']).trim();
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

console.log(`私库 HEAD：${headSha}　版本：v${version}`);

// ---------------------------------------------------------------------------
// 4. 建立临时 worktree
// ---------------------------------------------------------------------------

try { git(['worktree', 'prune']); } catch {}
const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ai-quote-make-free-'));
console.log(`创建临时 worktree：${worktreeRoot}`);
git(['worktree', 'add', '--detach', worktreeRoot, 'HEAD']);

function cleanupWorktree() {
  // git worktree remove 在 worktree 内有未提交改动 / 处于非 detached 分支等情况下可能仍会拒绝，
  // 因此即便 --force 失败，也要强制删除目录 + prune，确保分支引用不会一直被"占用"，
  // 否则下次执行会因为 free-release 分支仍显示"checked out at <已删除目录>"而无法删除重建。
  try {
    git(['worktree', 'remove', '--force', worktreeRoot]);
  } catch {
    try { rmSync(worktreeRoot, { recursive: true, force: true }); } catch {}
  }
  try { git(['worktree', 'prune']); } catch {}
  // 兜底：直接清掉 .git/worktrees 下对应的管理目录（若 prune 未识别为可清理）。
  try {
    const gitCommonDir = git(['rev-parse', '--git-common-dir']).trim();
    const adminDir = path.join(REPO_ROOT, gitCommonDir, 'worktrees', path.basename(worktreeRoot));
    if (existsSync(adminDir)) rmSync(adminDir, { recursive: true, force: true });
  } catch {}
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function runMakeFree(wt) {
  // 4a-0. 先切到孤儿分支：git checkout --orphan 会把工作区/索引重置为起点内容，
  // 必须在任何裁剪改动之前执行，否则后续改动会被这一步覆盖掉。
  // 若本仓已存在同名分支引用（worktree 与主仓共享引用空间），先删除以支持重复执行。
  try {
    git(['branch', '-D', 'free-release']);
  } catch {
    // 可能是残留的旧 worktree 仍占用该分支，prune 后重试一次。
    try { git(['worktree', 'prune']); } catch {}
    try { git(['branch', '-D', 'free-release']); } catch {}
  }
  gitIn(wt, ['checkout', '--orphan', 'free-release']);

  // 4a. 删除文件清单
  const DELETE_LIST = [
    'src/core/license',
    'src/main/license.ts',
    'src/main/priceBrowser.ts',
    'scripts/license-tool.mjs',
    'tests/core/license.test.ts',
    'tests/main/license.test.ts',
    'tests/main/ipc-license.test.ts',
    'CLAUDE.md',
    'docs/superpowers',
    '.github/workflows/mirror-gitee.yml',
  ];
  console.log('删除私库专有资产：');
  for (const rel of DELETE_LIST) {
    const full = path.join(wt, rel);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
      console.log(`  - ${rel}`);
    } else {
      console.log(`  - ${rel}（不存在，跳过）`);
    }
  }

  // 4b. 全仓扫描剥离 @premium 标记块
  console.log('剥离 @premium 标记块……');
  const stripSkipDirs = ['.git', 'node_modules', 'dist', 'out', 'build', 'resources'];
  const stripSkipPaths = ['scripts/make-free.mjs']; // 脚本自身包含标记语法样例，不参与剥离
  const files = listFiles(wt, { skipDirs: stripSkipDirs, skipPaths: stripSkipPaths });
  let strippedFileCount = 0;
  for (const file of files) {
    if (!isTextFile(file)) continue;
    const original = readFileSync(file, 'utf8');
    const stripped = stripPremiumBlocks(original, file);
    if (stripped !== original) {
      writeFileSync(file, stripped, 'utf8');
      strippedFileCount++;
      console.log(`  - ${path.relative(wt, file)}`);
    }
  }
  console.log(`共处理 ${strippedFileCount} 个文件。`);

  // 4c. 定点替换
  console.log('执行定点替换……');
  applyPreciseReplacements(wt);

  // 4d. 敏感 / 残留扫描
  console.log('执行敏感信息与残留扫描……');
  scanForLeftovers(wt);

  // 4e. 符号链接 node_modules，跑测试与 typecheck
  console.log('链接 node_modules 并运行测试……');
  const srcNodeModules = path.join(REPO_ROOT, 'node_modules');
  const dstNodeModules = path.join(wt, 'node_modules');
  if (existsSync(srcNodeModules) && !existsSync(dstNodeModules)) {
    symlinkSync(srcNodeModules, dstNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const tsTimestamp = listFiles(wt, { skipDirs: ['.git', 'node_modules'] })
    .filter((f) => /vitest\.config\.ts\.timestamp-.*\.mjs$/.test(f));
  for (const f of tsTimestamp) rmSync(f, { force: true });

  try {
    execFileSync('npx', ['vitest', 'run'], { cwd: wt, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch {
    fail('worktree 内 vitest 未全绿，已中止。');
  }
  try {
    execFileSync('npm', ['run', 'typecheck'], { cwd: wt, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch {
    fail('worktree 内 typecheck 未通过，已中止。');
  }

  // node_modules 只是本地符号链接（用于跑测试），且不受 .gitignore 的 "node_modules/" 规则匹配
  // （它现在是一个符号链接而非目录），提交前必须显式移除，否则会被 git add -A 当成一条新增条目提交。
  if (existsSync(dstNodeModules)) {
    rmSync(dstNodeModules, { force: true });
  }

  // 4f. 提交裁剪结果（孤儿分支已在流程开始时切好）
  console.log('生成孤儿提交……');
  gitIn(wt, ['add', '-A']);
  const commitMessage =
    `AI 报价单 免费版 v${version}——源自私库 ${headSha} 裁剪生成\n\n` +
    `本提交由 scripts/make-free.mjs 自动生成，裁剪基线：私库 HEAD ${headSha}，版本 v${version}。`;
  gitIn(wt, ['commit', '-m', commitMessage]);
  console.log(`已生成分支 free-release（裁剪基线 ${headSha} / v${version}）。`);

  // 4g. 推送 + 打 tag
  if (args.push) {
    console.log('推送 free-release:main 到 free 远程……');
    gitIn(wt, ['push', 'free', 'free-release:main', '--force']);
    console.log('推送完成。');

    if (args.tag) {
      const notes = args.notesFile ? readFileSync(args.notesFile, 'utf8') : args.tag;
      if (!args.notesFile) {
        console.log(`未提供 --notes-file，tag ${args.tag} 的附注信息将直接使用 tag 名本身；`);
        console.log('如需自定义发布说明，请改用：node scripts/make-free.mjs --push --tag <ver> --notes-file <path>');
      }
      // tag 命名空间在私库全局共享（worktree 亦然），本地用 free- 前缀避免与私库同名 tag 冲突，
      // 推送时映射为公开仓的目标 tag 名（refs/tags/<tag>）。
      const localTag = `free-${args.tag}`;
      gitIn(wt, ['tag', '-f', '-a', localTag, '-m', notes]);
      gitIn(wt, ['push', 'free', `refs/tags/${localTag}:refs/tags/${args.tag}`, '--force']);
      console.log(`已打并推送 tag ${args.tag}（本地引用 ${localTag}）。`);
    }
  } else {
    console.log('未指定 --push，仅在本地 worktree 生成 free-release 分支（worktree 即将清理，分支引用保留在私库 .git 中）。');
  }

  // 把生成的 free-release 分支指针复制回本仓（worktree 清理前先确保私库能看到该分支）
  const wtHead = gitIn(wt, ['rev-parse', 'HEAD']).trim();
  git(['update-ref', 'refs/heads/free-release', wtHead]);
  console.log(`私库本地分支 free-release 已指向 ${wtHead.slice(0, 7)}。`);
}

// ---------------------------------------------------------------------------
// @premium 标记剥离
// ---------------------------------------------------------------------------

const START_PATTERNS = [
  /^\s*\/\/\s*@premium-start\s*$/,
  /^\s*#\s*@premium-start\s*$/,
  /^\s*\{\/\*\s*@premium-start\s*\*\/\}\s*$/,
];
const END_PATTERNS = [
  /^\s*\/\/\s*@premium-end\s*$/,
  /^\s*#\s*@premium-end\s*$/,
  /^\s*\{\/\*\s*@premium-end\s*\*\/\}\s*$/,
];

function isStartMarker(line) {
  return START_PATTERNS.some((re) => re.test(line));
}
function isEndMarker(line) {
  return END_PATTERNS.some((re) => re.test(line));
}

function stripPremiumBlocks(content, filePath) {
  const lines = content.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (isStartMarker(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !isEndMarker(lines[j])) j++;
      if (j >= lines.length) {
        fail(`${filePath}：找到 @premium-start 但未找到匹配的 @premium-end。`);
      }
      i = j + 1; // 跳过整个标记块（含起止标记行）
      continue;
    }
    if (isEndMarker(lines[i])) {
      fail(`${filePath}：发现未配对的 @premium-end（第 ${i + 1} 行）。`);
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n');
}

// ---------------------------------------------------------------------------
// 定点替换
// ---------------------------------------------------------------------------

function replaceOnce(filePath, find, replace, { required = true } = {}) {
  if (!existsSync(filePath)) {
    if (required) fail(`定点替换失败：文件不存在 ${filePath}`);
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  if (!content.includes(find)) {
    if (required) fail(`定点替换失败：在 ${filePath} 中未找到预期文本：\n${find}`);
    return;
  }
  writeFileSync(filePath, content.split(find).join(replace), 'utf8');
}

function applyPreciseReplacements(wt) {
  // electron-builder.yml：发布仓库名
  replaceOnce(
    path.join(wt, 'electron-builder.yml'),
    'repo: ai-quote-releases',
    'repo: ai-quote-free',
  );

  // updater.ts：仓库名 + 友好错误文案
  const updaterPath = path.join(wt, 'src/main/updater.ts');
  replaceOnce(updaterPath, "const REPO = 'ai-quote-releases';", "const REPO = 'ai-quote-free';");
  replaceOnce(
    updaterPath,
    "const REPO_UNAVAILABLE_MESSAGE =\n  `无法访问更新源：发布仓库不存在或不可访问（请确认已创建公开仓库 ${OWNER}/${REPO}）`;",
    "const REPO_UNAVAILABLE_MESSAGE = '无法访问更新源：请检查网络连接';",
  );

  // tests/main/updater.test.ts、tests/main/ipc-update.test.ts：随 updater.ts 同步替换
  for (const rel of ['tests/main/updater.test.ts', 'tests/main/ipc-update.test.ts']) {
    const p = path.join(wt, rel);
    if (!existsSync(p)) continue;
    let content = readFileSync(p, 'utf8');
    // 先替换长错误文案（其内部含 ai-quote-releases，必须在仓库名替换之前处理，否则会被仓库名替换破坏匹配）
    content = content.split(
      '无法访问更新源：发布仓库不存在或不可访问（请确认已创建公开仓库 baotangyin/ai-quote-releases）',
    ).join('无法访问更新源：请检查网络连接');
    content = content.split('ai-quote-releases').join('ai-quote-free');
    writeFileSync(p, content, 'utf8');
  }

  // docs/启动指南.md：下载链接指向公开发布仓库
  const startGuidePath = path.join(wt, 'docs/启动指南.md');
  if (existsSync(startGuidePath)) {
    const content = readFileSync(startGuidePath, 'utf8');
    const replaced = content.split(
      'https://github.com/baotangyin/ai-quote/releases',
    ).join('https://github.com/baotangyin/ai-quote-free/releases');
    if (replaced === content) {
      fail(`定点替换失败：docs/启动指南.md 中未找到预期的 releases 链接`);
    }
    writeFileSync(startGuidePath, replaced, 'utf8');
  }

  // README.md ← README.free.md
  const readmeFreePath = path.join(wt, 'README.free.md');
  if (!existsSync(readmeFreePath)) fail('README.free.md 不存在，无法生成免费版 README。');
  const readmeFreeContent = readFileSync(readmeFreePath, 'utf8');
  writeFileSync(path.join(wt, 'README.md'), readmeFreeContent, 'utf8');
  rmSync(readmeFreePath, { force: true }); // README.free.md 本身是私库内部维护文件，不进入免费版仓库

  // Help.tsx：软件授权话题文案改为"免费使用"
  const helpPath = path.join(wt, 'src/renderer/src/pages/Help.tsx');
  replaceOnce(
    helpPath,
    "keywords: '软件授权 试用 机器码 许可导入 只读模式 授权文件',",
    "keywords: '软件授权 免费使用',",
  );
  replaceOnce(
    helpPath,
    [
      '        <Paragraph style={P}>',
      '          首次启动自动进入<Text strong>试用</Text>，试用期共 30 天，「设置 → 软件授权」显示剩余天数；试用到期或正式授权到期后，软件进入<Text strong>只读模式</Text>——数据仍可查看与导出，但新增 / 修改 / 删除等写操作会被拦截，需导入许可文件或联系供应商购买授权才能恢复。',
      '        </Paragraph>',
      '        <Paragraph style={P}>',
      '          <Text strong>机器码</Text>：授权与本机机器码绑定，「软件授权」卡片可复制机器码提供给供应商用于签发许可；点击「导入许可文件」选择供应商签发的许可文件（.aiqlic）完成<Text strong>许可导入</Text>，导入成功后需重启应用生效。许可方案分「永久授权」与「按年授权」（到期日可见）。',
      '        </Paragraph>',
    ].join('\n'),
    [
      '        <Paragraph style={P}>',
      '          本软件免费使用。',
      '        </Paragraph>',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// 敏感信息 / 残留扫描
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  { name: '私钥泄露', re: /BEGIN (?:RSA |EC |OPENSSH |ED25519 )?PRIVATE KEY/ },
  { name: 'GitHub PAT 泄露', re: /github_pat_[A-Za-z0-9_]+/ },
];

const LICENSE_LEFTOVER_PATTERNS = [
  /from ['"].*\/license['"]/,
  /assertWriteAllowed/,
  /computeMachineId/,
  /getLicenseState/,
  /importLicenseFile/,
  /\bLicenseState\b/,
  /\bLicenseStateKind\b/,
  /\bWRITE_CHANNELS\b/,
];

function scanForLeftovers(wt) {
  const skipDirs = ['.git', 'node_modules', 'dist', 'out', 'build', 'resources'];
  // make-free.mjs 自身以文本形式包含这些检测用的关键字/正则字面量，会对自己产生误报，跳过。
  const skipPaths = ['scripts/make-free.mjs'];
  const files = listFiles(wt, { skipDirs, skipPaths }).filter(isTextFile);
  const problems = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = path.relative(wt, file);
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(content)) problems.push(`${rel}：命中「${name}」`);
    }
    for (const re of LICENSE_LEFTOVER_PATTERNS) {
      const m = content.match(re);
      if (m) problems.push(`${rel}：疑似授权模块残留「${m[0]}」`);
    }
  }
  if (problems.length > 0) {
    console.error('发现以下问题，已中止：');
    for (const p of problems) console.error(`  - ${p}`);
    fail('敏感信息 / 授权残留扫描未通过。');
  }
  console.log('  扫描通过，未发现残留。');
}

// ---------------------------------------------------------------------------
// 入口：所有函数/常量声明完毕后再执行，避免 TDZ 问题
// ---------------------------------------------------------------------------

try {
  runMakeFree(worktreeRoot);
} finally {
  cleanupWorktree();
  console.log('已清理临时 worktree。');
}
