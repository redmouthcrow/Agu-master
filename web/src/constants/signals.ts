/** UI-Spec 附录 A 四档标准 signal */
export const STANDARD_SIGNALS = [
  '多头持股',
  '逢高减仓',
  '逢低做T',
  '空仓观望',
] as const;

export type StandardSignal = (typeof STANDARD_SIGNALS)[number];
