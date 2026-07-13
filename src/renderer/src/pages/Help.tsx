import React, { useMemo, useState } from 'react';
import { Typography, Collapse, Input, Empty, Tag, Space, Alert } from 'antd';

const { Title, Paragraph, Text } = Typography;

/** 一个帮助主题：title 为标题，keywords 供搜索命中，body 为正文。 */
interface HelpTopic {
  key: string;
  title: string;
  keywords: string;
  body: React.ReactNode;
}

const P: React.CSSProperties = { marginBottom: 8 };
// 与主题 colorBgLayout 一致，视觉不变，登记统一
const codeStyle: React.CSSProperties = {
  background: '#f5f5f5',
  padding: '1px 6px',
  borderRadius: 4,
  fontFamily: 'monospace'
};
const C = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <code style={codeStyle}>{children}</code>
);

const TOPICS: HelpTopic[] = [
  {
    key: 'overview',
    title: '1. 软件总览',
    keywords: '总览 简介 功能 流程 报价',
    body: (
      <>
        <Paragraph style={P}>
          本软件面向展厅 / 智能化集成行业，提供「统一设备成本库 + 多种报价模式一键出单 + AI
          辅助数据维护」。核心工作流：
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>① 维护产品库与供应商</Text>（可用 AI 报价单导入快速录入）→{' '}
          <Text strong>② 新建项目</Text>，选择报价模式 →{' '}
          <Text strong>③ 按 板块 / 空间 / 清单行 组织报价</Text>，可用联动规则自动补配套、用多供应商比价选定成本
          → <Text strong>④ 一键导出多版本 Excel</Text>。
        </Paragraph>
        <Paragraph style={P}>
          左侧菜单依次为：产品库、供应商、项目报价、概算指标、联动规则、报价单导入、设置、帮助。
        </Paragraph>
      </>
    )
  },
  {
    key: 'modes',
    title: '2. 四种报价模式',
    keywords: '模式 概算 方案预算 造价清单 投标 参数',
    body: (
      <>
        <Paragraph style={P}>新建项目时选择报价模式，决定使用哪套参数字段与导出列集：</Paragraph>
        <ul>
          <li>
            <Text strong>概算</Text>：项目总投资估算表（大类 / 子项结构，见「概算模式」一节）。
          </li>
          <li>
            <Text strong>方案预算</Text>：使用「核心参数」，含用电量、机柜、时序电源、网口、com口、成本等全列集。
          </li>
          <li>
            <Text strong>造价清单</Text>：使用「招标参数」，在方案预算基础上增加「推荐品牌」列。
          </li>
          <li>
            <Text strong>投标造价清单</Text>：使用「投标参数」，精简列集（至备注列止）。
          </li>
        </ul>
        <Paragraph style={P}>
          项目建好后仍可在项目页顶部切换模式，切换后清单沿用同一套数据、仅参数字段与导出列随之改变。
        </Paragraph>
      </>
    )
  },
  {
    key: 'products',
    title: '3. 产品库',
    keywords: '产品 分类 标签 参数 选配 成本价 品牌 型号',
    body: (
      <>
        <Paragraph style={P}>
          产品库是统一成本源。每个产品可含：多个<Text strong>分类标签</Text>（同一设备可归多类，如「LED屏」+「55寸」）、品牌 /
          型号、<Text strong>三套参数</Text>（核心 / 招标 / 投标，分别用于不同报价模式）、单位、规格尺寸、220V/380V
          用电量、机柜 U 数、时序电源路数、网口 / com口数、产品图，以及<Text strong>选配项</Text>（如「防眩光 +400元」，可带参数描述）。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>成本价规则</Text>：产品的生效成本价可配置为 最低价 / 最新记录 / 指定供应商，全局默认在「设置」中调整，也可对单个产品覆盖。价格记录来自供应商报价、AI 查价或手工录入。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>批量与筛选</Text>：顶部可按 分类（多选）、品牌、名称 / 型号关键词 组合筛选（条件为「与」，筛选会被记住）；勾选多行后可 批量删除 / 批量改分类 / 批量加标签 / 导出选中为 Excel。
        </Paragraph>
      </>
    )
  },
  {
    key: 'categorytemplates',
    title: '4. 类别参数模板',
    keywords: '类别参数模板 分类默认值 自动填充 技术参数',
    body: (
      <>
        <Paragraph style={P}>
          在「产品库」页「类别参数模板」入口，可按<Text strong>分类</Text>配置一套默认技术参数：单位、220V/380V
          用电量、机柜 U 数、时序电源路数、网口 / com口数，以及核心 / 招标 / 投标三套参数文本，每个分类最多一份模板。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>两个应用时机</Text>：① 手工新建 / 编辑产品时，按其所属分类自动填充对应字段；② AI
          报价单导入落库时同样按分类自动补齐。两处均<Text strong>仅填空值</Text>，不会覆盖你已手工填写或识别出的字段。
        </Paragraph>
        <Paragraph style={P}>
          产品可归属多个分类时，按分类顺序取<Text strong>首个存在模板的分类</Text>生效，不会叠加多个模板。
        </Paragraph>
      </>
    )
  },
  {
    key: 'suppliers',
    title: '5. 供应商',
    keywords: '供应商 联系人 电话 地址 付款方式 开户信息 批量 导出',
    body: (
      <Paragraph style={P}>
        管理供应商（名称 / 联系人 / 电话 / 地址 / 付款方式 / 开户信息 / 备注）。价格记录、AI 报价单导入、询价单均可关联供应商。支持关键词筛选、多选批量删除、导出选中为 Excel。
      </Paragraph>
    )
  },
  {
    key: 'inquiry',
    title: '6. 供应商询价单',
    keywords: '询价单 回价 写入价格记录 供应商 生成询价单',
    body: (
      <>
        <Paragraph style={P}>
          在项目清单中勾选若干行后点「生成询价单」，可按选定的一个或多个供应商各生成一张<Text strong>不含我方价格</Text>的询价单（每个供应商一张），用于向供应商询价。
        </Paragraph>
        <Paragraph style={P}>
          在「供应商」页对应供应商行点「询价单」，可查看该供应商全部询价单列表，进入详情逐行填写<Text strong>供应商回价</Text>，也可导出为 Excel 发给供应商。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>回价闭环</Text>：已填回价且关联产品库产品的行，可一键「写入价格记录」，直接回写为该产品的一条新成本价记录；手工行（无关联产品）不支持写入，需先在产品库建档。
        </Paragraph>
      </>
    )
  },
  {
    key: 'import',
    title: '7. AI 报价单导入',
    keywords: 'ai 导入 报价单 识别 excel 图片 识价',
    body: (
      <>
        <Paragraph style={P}>
          将供应商的 xls/xlsx 报价单导入为结构化产品与价格。流程：选择文件 → 程序预处理（展开合并单元格、拆分一个 sheet 内并排的多张表）→ AI 结构化识别 → 逐条人工确认（低置信度字段高亮、可编辑；与库内产品按品牌+型号匹配，命中的显示「更新价格」而非新建）→ 入库。
        </Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="AI 功能需先在「设置」中新增至少一个 AI 配置档案（协议 + Base URL + API Key + 模型名）并绑定「文本识别」用途，否则识别会提示未配置。"
        />
      </>
    )
  },
  {
    key: 'project',
    title: '8. 项目结构与快照',
    keywords: '项目 板块 空间 展项 清单行 快照 小计 集成费',
    body: (
      <>
        <Paragraph style={P}>
          项目采用四层结构：<Text strong>项目 → 板块 → 空间/展项 → 清单行</Text>。板块对应导出的独立
          sheet，可设系统集成费比例；空间对应清单里的「一 / 二 / 三」层级并自动生成小计；清单行可来自产品库或手工录入。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>快照机制</Text>：清单行创建时会把产品的名称、参数、成本单价等复制进快照，此后产品库变动不影响已有项目。当库内成本价与快照不一致时，行上会显示提示角标，可单行或整项目一键刷新快照。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>定价口径</Text>：对外单价优先级为 手动直接输入 &gt; 行级倍率 &gt; 项目默认倍率（单价 = 成本单价 × 倍率）。手动定价的行，成本刷新不会自动改动其单价。
        </Paragraph>
      </>
    )
  },
  {
    key: 'estimate',
    title: '9. 概算模式（项目总投资估算表）',
    keywords: '概算 投资估算 大类 子项 系数 引用板块 万元 指标',
    body: (
      <>
        <Paragraph style={P}>
          将项目模式设为「概算」后，项目页显示投资估算表编辑器。结构为可配置的<Text strong>大类 → 子项</Text>，可「载入默认结构」（布展装饰 / 安装 / 陈列布展 / 多媒体系统 / 其他费用等）。
        </Paragraph>
        <Paragraph style={P}>每个子项有三种取值方式并存：</Paragraph>
        <ul>
          <li>
            <Text strong>手工填报</Text>：直接输入金额。
          </li>
          <li>
            <Text strong>按系数估算</Text>：金额 = 基数 × 系数。
          </li>
          <li>
            <Text strong>引用板块合价</Text>：引用本项目某清单板块的合价（含集成费），随清单联动。
          </li>
        </ul>
        <Paragraph style={P}>
          大类小计与总投资自动汇总，可在 元 / 万元 之间切换显示（概算惯用万元）。导出为「项目总投资估算表」，采用万元制、保留活公式。「概算指标」菜单可维护每㎡单价区间作为填报参考。
        </Paragraph>
      </>
    )
  },
  {
    key: 'rules',
    title: '10. 联动规则引擎',
    keywords: '规则 联动 触发 动作 公式 变量 配套 bom 接收卡 交换机',
    body: (
      <>
        <Paragraph style={P}>
          在「联动规则」中配置规则，让主设备加入清单时自动带出配套项（不静默添加，会弹出配套清单面板供勾选确认）。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>规则 = 触发条件 + 动作列表</Text>。触发条件可为「某分类被加入」「某具体产品被加入」或「项目类型属性」；每个动作 = 关联产品 + 数量公式 + 必选 / 可选。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>数量公式</Text>支持变量与函数，是否取整由你在公式里自行写 <C>ceil()</C> 控制。编辑规则时点数量公式旁的 ⓘ 可查看「可用变量与函数」完整中文说明。常用示例：
        </Paragraph>
        <ul>
          <li>
            LED 接收卡：<C>ceil(area*270000/512)</C>
          </li>
          <li>
            LED 电源：<C>ceil(power*1.2/300)</C>
          </li>
          <li>
            交换机（项目级）：<C>ceil(projNetPorts*1.2/24)</C>
          </li>
        </ul>
        <Paragraph style={P}>
          规则列表支持按触发类型 / 关键词筛选、多选批量删除、批量启用 / 停用。
        </Paragraph>
      </>
    )
  },
  {
    key: 'costcompare',
    title: '11. 多供应商比价',
    keywords: '比价 供应商 候选 成本 生效 成本对比版 导出',
    body: (
      <>
        <Paragraph style={P}>
          同一清单行可并联多条<Text strong>候选成本方案</Text>（供应商 / 品牌 / 型号 / 成本单价）。在清单行的「比价」入口打开面板，可「从供应商报价生成」候选，或手工新增，并<Text strong>勾选一条为生效成本</Text>——生效成本会回写该行、联动重算单价与合计。
        </Paragraph>
        <Paragraph style={P}>
          选定某候选后，该行不再因与产品库规则价不同而误报「价格已更新」；刷新快照也会保留你选定的候选成本。
        </Paragraph>
        <Paragraph style={P}>
          项目导出区的「导出成本对比版」会把每行的全部候选方案并排呈现，并标注生效方案。
        </Paragraph>
      </>
    )
  },
  {
    key: 'export',
    title: '12. 导出',
    keywords: '导出 excel xlsx 含成本 对外 实施清单 成本对比 汇总',
    body: (
      <>
        <Paragraph style={P}>非概算模式一次导出多份 xlsx（汇总表 + 每板块明细 sheet，保留活公式）：</Paragraph>
        <ul>
          <li>
            <Text strong>含成本完整版</Text>：全部列（含成本 / 比例）。
          </li>
          <li>
            <Text strong>对外报价版</Text>：删除成本相关列，保留备注。
          </li>
          <li>
            <Text strong>实施清单</Text>：删除价格列、保留技术列（投标模式含实施清单；概算模式无此变体）。
          </li>
        </ul>
        <Paragraph style={P}>
          另有「导出成本对比版」（多供应商并排）与「产品库 / 供应商 导出选中」。概算模式导出「项目总投资估算表」。
        </Paragraph>
      </>
    )
  },
  {
    key: 'batch',
    title: '13. 批量操作与筛选',
    keywords: '批量 多选 全选 筛选 记住 删除 导出',
    body: (
      <>
        <Paragraph style={P}>各列表（产品 / 供应商 / 项目 / 规则 / 概算指标）统一支持：</Paragraph>
        <ul>
          <li>
            <Text strong>多选 / 全选</Text>：勾选多行，表头可全选当前筛选结果；「已选 N 项」工具条提供批量按钮，可一键清空选择。
          </li>
          <li>
            <Text strong>深度筛选</Text>：多条件组合（「与」逻辑），如产品按 分类+品牌+关键词、项目按 模式+状态+关键词。
          </li>
          <li>
            <Text strong>记住筛选</Text>：每个列表的筛选条件会被记住，下次打开自动恢复。
          </li>
          <li>
            <Text strong>批量动作</Text>：通用批量删除；产品批量改分类 / 加标签 / 导出选中；项目批量改状态 / 复制；规则批量启用 / 停用。
          </li>
        </ul>
      </>
    )
  },
  {
    key: 'settings',
    title: '14. 设置',
    keywords: '设置 成本价规则 默认倍率 ai 配置档案 多厂家 舍入 关闭到托盘 开机自启 通用',
    body: (
      <>
        <Paragraph style={P}>
          在「设置」中配置：全局成本价规则（最低价 / 最新 / 指定供应商）、新建项目默认倍率、金额舍入规则，以及 <Text strong>AI 配置档案</Text>——可新增多个厂家/账号的 AI 接口档案（名称 + 协议 + Base URL + API Key + 模型名），分别为「文本识别」（报价单导入识别、导出模板解析）、「图片处理」（图纸识别）、「定时查价」三种用途绑定档案，可共用同一档案也可分开；每个档案可单独「测试连接」。删除已被绑定的档案时，对应用途会自动回退绑定到剩余档案的第一个并提示。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>应用行为</Text>：<Text strong>关闭窗口时最小化到托盘</Text>（开启后点击关闭按钮只隐藏窗口，需从托盘菜单「退出」才真正退出）与<Text strong>开机自动启动</Text>（登录系统后自动启动本软件，默认关闭，mac / Windows 均支持，Linux 暂不支持）两个开关位于「查价监控配置」卡片内，与查价设置一起保存。查价监控、软件更新、软件授权分别见下方对应章节。
        </Paragraph>
      </>
    )
  },
  {
    key: 'templates',
    title: '15. 项目模板',
    keywords: '项目模板 类型模板 空间置底 骨架 板块空间 空间联动开关',
    body: (
      <>
        <Paragraph style={P}>
          在「项目模板」中按<Text strong>项目类型</Text>预置一套板块与空间骨架：新建项目时选择对应类型，会自动按模板生成初始板块与空间（类型可留空，不套用模板）。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>空间置底</Text>：模板中的空间可标记「置底」，置底空间恒排在所属板块末尾；无论是手工新增空间还是由「空间联动」（见「板块报价表与空间联动」一节）同步过来的新空间，都会自动插入到置底空间之前，不会打乱置底顺序。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>板块空间联动开关</Text>：模板中的每个板块也可单独开启「空间联动」（默认关闭，需按需手动开启）——按此模板新建项目时，开关状态会作为对应板块的初始状态，联动板块从项目一开始就随第一板块（联动源板块）同步空间，无需新建后再逐个手动开启。出厂「展厅」模板的「软件影片」「装修装饰」两个板块默认已开启该开关；用户自建模板与历史存量模板默认关闭，如需要请自行打开。生成后仍可在项目内「新增 / 编辑板块」弹窗随时调整，与模板脱钩。
        </Paragraph>
        <Paragraph style={P}>
          模板删除不影响已用该模板创建的项目（项目内数据已固化，与模板脱钩）。
        </Paragraph>
      </>
    )
  },
  {
    key: 'exporttemplates',
    title: '16. 导出模板',
    keywords: '导出模板 版本集 ai 识别 客户 xlsx 出厂模板 标准三版本 自定义列',
    body: (
      <>
        <Paragraph style={P}>
          「导出模板」管理导出 Excel 的抬头 / 落款、样式与<Text strong>版本集</Text>（多套列集，即「含成本完整版 / 对外报价版 / 实施清单」这类导出版本的来源）。出厂内置「标准三版本」模板，可编辑或删除；每个版本可勾选启用哪些系统列、调整顺序与显示名 / 宽度，并配置是否生成汇总表、空间小计、系统集成费、合计行、税率等。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>自定义列</Text>：每个版本除系统列外，还可点「添加自定义列」新增任意数量的自定义列，填写列名、宽度与「固定内容」（同一版本下每行都填充相同的固定文本，可留空）；自定义列不参与系统列的模式列集判断，恒会出现在该版本导出结果中，适合填「供货范围」「质保期」一类与产品无关的固定说明列，顺序与显示名可与系统列一样自由调整。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>AI 识别客户 xlsx</Text>：点击「从 xlsx 导入」选择客户自己的 Excel 模板文件，AI 会识别其表头结构并自动生成一份对应的导出模板（无法识别的列会在保存前提示「以下列系统无对应字段，已忽略」），后续导出即可直接套用客户原有格式。
        </Paragraph>
      </>
    )
  },
  {
    key: 'drawing',
    title: '17. 图纸识别',
    keywords: '图纸识别 图片 pdf 视觉 图片处理用途绑定 两入口 标注 识别率 标注建议 空间名 数量 矢量文字',
    body: (
      <>
        <Paragraph style={P}>
          「图纸识别」向导可从图纸（PDF / png / jpg / webp，dwg / dxf 暂不支持，需先导出为 PDF 或图片）批量识别出空间与设备清单，流程为：选目标 → 上传 → 识别 → 核对（可编辑空间名 / 设备名称 / 数量 / 备注，可重新匹配产品或设为手工行）→ 生成。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>两入口</Text>：识别目标可选「新建项目」（直接建新项目承接识别结果）或「导入到已有项目」（选择已有项目与板块追加识别结果），二者共用同一套识别与核对流程。
        </Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="图纸识别依赖具备视觉（图片输入）能力的模型，可在「设置 → AI 配置档案」中新增档案并单独绑定「图片处理」用途，未单独绑定则与「文本识别」共用同一档案。"
        />
        <Paragraph style={P}>
          <Text strong>图纸标注建议（提高识别率）</Text>：
        </Paragraph>
        <Paragraph style={P}>
          ① <Text strong>空间名</Text>写在空间区域内部的明显位置，字号大于设备标注——识别按空间名给设备分组，空间名缺失或与图线重叠是分组错误的主因。
          ② <Text strong>设备标注</Text>统一为「设备名×数量」并紧挨着写（如「65寸电容触控一体机×2」，「*2」「2台」「2套」也可识别，同一张图建议用同一种写法）；不标数量默认按 1；尺寸规格写进名称（如「P2.5 LED屏 3×2m」「55寸拼接屏×9」）会被单独提取。
          ③ <Text strong>设备命名与产品库保持一致</Text>——识别后按名称自动匹配产品库，命名统一可大幅提高自动关联率。
          ④ 推荐<Text strong>清单式标注</Text>：在每个空间旁放一个文字块逐行列出设备（首行空间名，下面每行一台/一组设备），识别率最高、核对最省事。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>图面质量</Text>：CAD 导出 PDF 时保留矢量文字（不要将文字炸开为线条）；文字避免与底图线条重叠，深色文字浅色底；上传图片最长边会压缩到 2000 像素，<Text strong>特大图纸建议按区域拆成多张上传</Text>（每张独立识别后自动合并，重名空间会合并设备）；避免手写体、艺术字与过小字号。图例表、尺寸标注线、指北针等非设备文字无需清理，识别时会自动忽略。
        </Paragraph>
      </>
    )
  },
  {
    key: 'analytics',
    title: '18. 统计分析',
    keywords: '统计分析 利润 利润率 价格趋势 价格异动 涨幅榜 跌幅榜',
    body: (
      <>
        <Paragraph style={P}>
          「统计分析」含总览、产品利润、价格趋势、价格异动四个页签，可按时间范围（近30天 / 近90天 / 今年 / 全部 / 自定义）与「仅已完成」项目筛选。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>利润口径</Text>：利润 = 报价合计 − 成本合计，取数来自各清单行创建 / 刷新时固化的<Text strong>快照成本</Text>（按当时的成本价规则计算），而非重新按当前供应商报价实时计算，因此反映的是项目实际下单口径的历史成本，不会随产品库价格变动而变化。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>价格趋势</Text>页签按产品展示其历史价格记录折线图与明细（来源含 供应商报价 / AI查价 / 手动）；<Text strong>价格异动</Text>页签展示最近一轮查价的运行状态与结果，并按涨跌幅列出「涨幅榜」「跌幅榜」，点击可跳转到对应产品的价格趋势。
        </Paragraph>
      </>
    )
  },
  {
    key: 'watch',
    title: '19. 价格监控与定时查价',
    keywords: '价格监控 定时查价 联网 托盘 异动提醒 命中率 型号 截图识价 比价浏览器',
    body: (
      <>
        <Paragraph style={P}>
          在「设置 → 查价监控配置」中开启价格监控后，软件会按设定周期（每日 / 每周 / 每月）对已标记「监控」的产品自动查价并写入价格记录，超过设定阈值的涨跌视为异动，可在「统计分析 → 价格异动」中查看，也可点击「立即查价」手动触发一轮。
        </Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="定时查价需绑定支持联网搜索的模型档案，可在「设置 → AI 配置档案」中新增档案并单独绑定「定时查价」用途，未单独绑定则与「文本识别」共用同一档案。"
        />
        <Paragraph style={P}>
          <Text strong>托盘</Text>：开启「关闭窗口时最小化到托盘」后，关闭主窗口不会退出程序，可从系统托盘图标菜单「打开主界面」「立即查价」「退出」中操作；定时查价在托盘常驻时仍会按周期在后台运行。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>提高查价命中率</Text>：查价按产品的<Text strong>名称 + 品牌 + 型号 + 规格</Text>组合搜索，其中<Text strong>型号最关键</Text>——型号越准确、越完整，AI 联网搜到的商品页与真实价格就越可信，建议在产品库中规范维护品牌与型号字段（避免空缺或写成笼统描述）；名称、规格也应尽量贴近实际采购品名。查价用的模型档案是否开启「联网搜索选项」（在「设置 → AI 配置档案」中按厂商选择，如智谱 / 通义 / MiniMax / 自定义参数）直接决定能否检索到实时价格，未正确配置时大概率查不到。查不到可靠来源或识别出的价格异常（如超出历史价格 20 倍 / 低于 1/20）时会自动判定为跳过或失败，不会写入价格记录，也不会编造价格。若某产品始终查不到，或想临时录入一个电商平台看到的价格，可在产品的「价格」面板中使用<Text strong>「截图识价」</Text>兜底：手动截图商品页后粘贴或拖入，AI 仅识别截图内容（不会自动访问任何网页），识别结果确认无误后手动写入价格记录。
        </Paragraph>
      </>
    )
  },
  {
    key: 'update',
    title: '20. 软件更新',
    keywords: '软件更新 自动更新 版本 mac 手动下载',
    body: (
      <>
        <Paragraph style={P}>
          「设置 → 软件更新」显示当前版本号，可点击「立即检查」查询是否有新版本，发现新版本时会展示版本号与更新说明。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>双模式</Text>：「自动下载并提示重启安装」在后台下载完成后提示「重启安装」一键完成升级；「仅提示新版本，手动打开下载页」只弹出提示，需手动打开下载页获取安装包。
        </Paragraph>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message="mac 限制：未签名的 macOS 版本不支持自动安装，自动模式选项在 mac 上不可选，只能使用「打开下载页」手动下载安装。"
        />
      </>
    )
  },
  {
    key: 'license',
    title: '21. 软件授权',
    keywords: '软件授权 免费使用',
    body: (
      <>
        <Paragraph style={P}>
          本软件免费使用。
        </Paragraph>
      </>
    )
  },
  {
    key: 'linkedspaces',
    title: '22. 板块报价表与空间联动',
    keywords: '空间联动 联动源板块 板块报价表 同步空间',
    body: (
      <>
        <Paragraph style={P}>
          项目内<Text strong>排序第一的板块</Text>自动作为「联动源板块」。其它板块在「新增 / 编辑板块」弹窗中可开启「联动源板块空间」开关，开启后联动源板块内新增或改名的空间会自动同步到本板块（删除不同步，置底空间不参与联动）；联动源板块自身没有该开关（对其自身无意义）。
        </Paragraph>
        <Paragraph style={P}>
          该机制用于多个板块共用同一套空间划分（如「一楼展厅」「二楼展厅」）时，只需在源板块维护空间结构，其余联动板块自动保持同步，减少重复录入；同步成功后会提示「已同步到 N 个联动板块」。
        </Paragraph>
      </>
    )
  },
  {
    key: 'backup',
    title: '23. 数据备份与还原',
    keywords: '备份 还原 恢复 迁移电脑 数据安全',
    body: (
      <>
        <Paragraph style={P}>
          「设置 → 数据备份」卡片可一键操作：<Text strong>备份数据到…</Text>选择目标文件夹后，在线生成一份完整的数据库文件（含全部产品、项目、供应商与设置），文件名形如{' '}
          <Text code>ai-quote-backup-20260713-153000.db</Text>，成功后可点「在文件夹中显示」定位；备份过程不影响正常使用。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>从备份还原…</Text>选择一个 <Text code>.db</Text> 备份文件，软件会先校验文件合法性（非本软件备份、损坏、或来自更高版本会明确提示原因），
          确认还原后会提示「还原将替换当前全部数据与设置」——<Text strong>当前数据会自动留底</Text>（保存在应用数据目录下，文件名含 <Text code>.bak-</Text> 时间戳，不会被覆盖或删除），
          需点击「立即重启」应用后才会实际生效。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>典型用途</Text>：定期备份防止数据丢失；更换电脑时先在旧机器备份，再在新机器安装软件后用「从备份还原」一键迁移全部数据与设置。免费版同样支持数据备份与还原。
        </Paragraph>
      </>
    )
  },
  {
    key: 'faq',
    title: '24. 常见问题',
    keywords: 'faq 常见问题 价格已更新 概算灰 离线 备份',
    body: (
      <>
        <Paragraph style={P}>
          <Text strong>Q：清单行出现「价格已更新」角标？</Text> 说明库内生效成本价与该行快照不一致。可单行或整项目刷新快照采用新成本；已在比价中选定候选成本的行不会误报。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>Q：数量公式怎么写？</Text> 见「联动规则引擎」一节，或在规则编辑弹窗点数量公式旁的 ⓘ 查看全部可用变量与函数。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>Q：AI 识别 / 查价提示未配置？</Text> 请先在「设置 → AI 配置档案」新增至少一个档案并确认对应用途（文本识别 / 图片处理 / 定时查价）已绑定档案。AI 功能需联网。
        </Paragraph>
        <Paragraph style={P}>
          <Text strong>Q：数据存在哪里？</Text> 本地单文件数据库，建议在「设置 → 数据备份」定期手动备份，或换机时用它一键迁移数据。
        </Paragraph>
      </>
    )
  }
];

export default function Help(): React.JSX.Element {
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return TOPICS;
    return TOPICS.filter(
      (t) => t.title.toLowerCase().includes(k) || t.keywords.toLowerCase().includes(k)
    );
  }, [keyword]);

  const items = filtered.map((t) => ({ key: t.key, label: t.title, children: t.body }));

  return (
    <div>
      <Space align="center" style={{ marginTop: 0, marginBottom: 16 }}>
        <Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
          帮助
        </Title>
        <Tag color="blue">使用文档</Tag>
      </Space>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        下面按功能分节介绍软件用法。可用关键词搜索定位，点击标题展开 / 收起。
      </Paragraph>
      <Input.Search
        allowClear
        placeholder="搜索帮助主题，如「概算」「公式」「批量」"
        style={{ maxWidth: 420, marginBottom: 16 }}
        onChange={(e) => setKeyword(e.target.value)}
      />
      {items.length === 0 ? (
        <Empty description="未找到匹配的帮助主题" />
      ) : (
        <Collapse
          items={items}
          defaultActiveKey={keyword ? filtered.map((t) => t.key) : ['overview']}
        />
      )}
    </div>
  );
}
