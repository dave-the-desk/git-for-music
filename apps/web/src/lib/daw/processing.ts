export function calculateStretchRatio(sourceTempoBpm: number, targetTempoBpm: number) {
  if (sourceTempoBpm <= 0 || targetTempoBpm <= 0) {
    throw new Error('Tempo values must be positive');
  }
  return targetTempoBpm / sourceTempoBpm;
}
