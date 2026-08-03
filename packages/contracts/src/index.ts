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

export type UserRole = 'interviewer' | 'admin' | 'data_admin';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser {
  id: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  csrf_token: string;
}

export interface CsrfResponse {
  csrf_token: string;
}

export interface LogoutResponse {
  logged_out: true;
}
