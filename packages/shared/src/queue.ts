export type AudioJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type AudioJobOperationType =
  | 'WAVEFORM_GENERATION'
  | 'DURATION_ANALYSIS'
  | 'BASIC_AUDIO_METADATA'
  | 'TEMPO_ANALYSIS'
  | 'KEY_ANALYSIS'
  | 'VOCAL_DETECTION'
  | 'TRANSCRIPTION'
  | 'PITCH_SHIFT'
  | 'TIME_STRETCH';

export interface AudioProcessingJobPayload {
  processingJobId: string;
  demoId: string;
  demoVersionId: string;
  trackId: string;
  trackVersionId: string;
  operationType: AudioJobOperationType;
  inputStorageKey: string;
  outputStoragePrefix: string;
}

export interface AudioQueueMessage {
  messageId: string;
  payload: AudioProcessingJobPayload;
}

export interface AudioQueueService {
  enqueueAudioJob(payload: AudioProcessingJobPayload): Promise<AudioQueueMessage | void>;
}
