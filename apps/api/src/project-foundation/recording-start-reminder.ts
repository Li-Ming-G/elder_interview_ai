import {
  RECORDING_START_REMINDER_TEXT,
  RECORDING_START_REMINDER_VERSION,
  type RecordingStartReminderProjection,
} from '@elder-interview/contracts';

export const RECORDING_START_REMINDER: RecordingStartReminderProjection = {
  action_label: '开始访谈',
  creates_consent_record: false,
  requires_explicit_action: true,
  text: RECORDING_START_REMINDER_TEXT,
  version: RECORDING_START_REMINDER_VERSION,
};
