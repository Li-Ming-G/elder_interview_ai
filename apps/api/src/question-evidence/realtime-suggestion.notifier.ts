import type { SuggestionPresentationChangedPayload } from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';

import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { SuggestionPresentationNotifier } from './question-presentation.service.js';

@Injectable()
export class RealtimeSuggestionNotifier extends SuggestionPresentationNotifier {
  public constructor(private readonly realtime: RealtimeRuntimeService) {
    super();
  }

  public override publish(
    sessionId: string,
    change: SuggestionPresentationChangedPayload,
  ): Promise<void> {
    return this.realtime.publishSuggestionChanged(sessionId, change);
  }
}
