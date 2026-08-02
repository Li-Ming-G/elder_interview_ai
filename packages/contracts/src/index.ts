export interface ApiErrorEnvelope {
  code: string;
  details: Record<string, unknown>;
  message: string;
  request_id: string;
}

export interface HealthResponse {
  database: 'up';
  status: 'ok';
  timestamp: string;
}
