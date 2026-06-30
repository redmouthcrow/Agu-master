/** UI-Spec 附录 A 五档标准 signal */
export const STANDARD_SIGNALS = [
  '多头持股',
  '持股观望',
  '逢高减仓',
  '逢低做T',
  '空仓观望',
] as const;

export type StandardSignal = (typeof STANDARD_SIGNALS)[number];
