import type { TemplateSection } from '../domain/types';

/** 出厂「展厅」项目类型模板：仅在模板表为空时播种（v5 迁移），用户可在模板管理页自行调整。 */
export const FACTORY_EXHIBITION_SECTIONS: TemplateSection[] = [
  {
    name: '多媒体硬件', integrationFeeRate: 0, isHardware: true,
    spaces: [
      { name: '安防监控系统设备', description: null, pinBottom: true },
      { name: '中控及网络设备', description: null, pinBottom: true }
    ]
  },
  { name: '软件影片', integrationFeeRate: 0, isHardware: false, spaces: [] },
  { name: '装修装饰', integrationFeeRate: 0, isHardware: false, spaces: [] }
];
