import type {
  ConsentResponse,
  CreateConsentRequest,
  CreateNextSessionRequest,
  CreateProjectRequest,
  CreateServiceTermRequest,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';

const DATABASE_NAME = 'elder-interview-new-workflow';
const DATABASE_VERSION = 2;
const WORKFLOW_STORE = 'workflows';
const ACTOR_INDEX = 'by-actor';
const SESSION_ATTEMPT_STORE = 'session-attempts';
const NEXT_SESSION_ATTEMPT_STORE = 'next-session-attempts';

export type WorkflowStep =
  'project' | 'service_term' | 'session' | 'consent_audio' | 'consent' | 'start' | 'complete';

export type AttemptState = 'prepared' | 'unknown_response' | 'acknowledged';

export interface StableCreateAttempt<Payload, Response> {
  payload: Payload;
  requestId: string;
  response: Response | null;
  state: AttemptState;
}

export interface NewInterviewWorkflow {
  actorId: string;
  consentAttempt: StableCreateAttempt<CreateConsentRequest, ConsentResponse> | null;
  consentAudioJobId: string | null;
  consentAudioObjectId: string | null;
  createdAt: string;
  projectAttempt: StableCreateAttempt<CreateProjectRequest, ProjectResponse> | null;
  serviceTermAttempt: StableCreateAttempt<CreateServiceTermRequest, ServiceTermResponse> | null;
  sessionAttempt: StableCreateAttempt<{ request_id: string }, InterviewSessionResponse> | null;
  status: 'active' | 'complete' | 'retired';
  step: WorkflowStep;
  updatedAt: string;
  workflowId: string;
}

interface DetachedSessionAttempt {
  actorId: string;
  key: string;
  projectId: string;
  requestId: string;
}

export interface NextSessionAttempt {
  actorId: string;
  key: string;
  payload: CreateNextSessionRequest;
  projectId: string;
  state: 'prepared' | 'unknown_response';
}

export class IndexedDbNewInterviewWorkflowStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  public constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  public async create(actorId: string): Promise<NewInterviewWorkflow> {
    const now = new Date().toISOString();
    const workflow: NewInterviewWorkflow = {
      actorId,
      consentAttempt: null,
      consentAudioJobId: null,
      consentAudioObjectId: null,
      createdAt: now,
      projectAttempt: null,
      serviceTermAttempt: null,
      sessionAttempt: null,
      status: 'active',
      step: 'project',
      updatedAt: now,
      workflowId: globalThis.crypto.randomUUID(),
    };
    await this.put(workflow);
    return workflow;
  }

  public async getActive(actorId: string): Promise<NewInterviewWorkflow | null> {
    const database = await this.database();
    const transaction = database.transaction(WORKFLOW_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const values = await idbRequest(
      transaction.objectStore(WORKFLOW_STORE).index(ACTOR_INDEX).getAll(actorId) as IDBRequest<
        NewInterviewWorkflow[]
      >,
    );
    await completion;
    const active =
      values
        .filter((value) => value.actorId === actorId && value.status === 'active')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    // DEV-008A4 keeps the legacy field/step readable but never creates a price row.
    // An interrupted pre-A4 browser workflow resumes at early session creation.
    if (
      active !== null &&
      active.projectAttempt?.response !== null &&
      active.sessionAttempt?.response == null &&
      active.step !== 'project'
    ) {
      return { ...active, step: 'session' };
    }
    return active;
  }

  public async getOrCreateDetachedSessionRequestId(
    actorId: string,
    projectId: string,
  ): Promise<string> {
    const database = await this.database();
    const key = `${actorId}:${projectId}`;
    const transaction = database.transaction(SESSION_ATTEMPT_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(SESSION_ATTEMPT_STORE);
    const existing = await idbRequest(
      store.get(key) as IDBRequest<DetachedSessionAttempt | undefined>,
    );
    if (existing !== undefined) {
      await completion;
      return existing.requestId;
    }
    const requestId = globalThis.crypto.randomUUID();
    await idbRequest(
      store.put({ actorId, key, projectId, requestId } satisfies DetachedSessionAttempt),
    );
    await completion;
    return requestId;
  }

  public async acknowledgeDetachedSession(actorId: string, projectId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(SESSION_ATTEMPT_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    await idbRequest(
      transaction.objectStore(SESSION_ATTEMPT_STORE).delete(`${actorId}:${projectId}`),
    );
    await completion;
  }

  public async getOrCreateNextSessionAttempt(
    actorId: string,
    projectId: string,
    basisSessionId: string,
    basisSequenceNo: number,
  ): Promise<NextSessionAttempt> {
    const database = await this.database();
    const key = `${actorId}:${projectId}`;
    const transaction = database.transaction(NEXT_SESSION_ATTEMPT_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(NEXT_SESSION_ATTEMPT_STORE);
    const existing = await idbRequest(store.get(key) as IDBRequest<NextSessionAttempt | undefined>);
    if (existing !== undefined) {
      await completion;
      return existing;
    }
    const requestId = globalThis.crypto.randomUUID();
    const attempt: NextSessionAttempt = {
      actorId,
      key,
      payload: {
        basis_session_id: basisSessionId,
        expected_basis_sequence_no: basisSequenceNo,
        request_id: requestId,
        workflow_version: 'repeat-interview-v1',
      },
      projectId,
      state: 'prepared',
    };
    await idbRequest(store.put(attempt));
    await completion;
    return attempt;
  }

  public async listNextSessionAttempts(actorId: string): Promise<NextSessionAttempt[]> {
    const database = await this.database();
    const transaction = database.transaction(NEXT_SESSION_ATTEMPT_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const attempts = await idbRequest(
      transaction.objectStore(NEXT_SESSION_ATTEMPT_STORE).getAll() as IDBRequest<
        NextSessionAttempt[]
      >,
    );
    await completion;
    return attempts.filter((attempt) => attempt.actorId === actorId);
  }

  public async markNextSessionUnknown(attempt: NextSessionAttempt): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(NEXT_SESSION_ATTEMPT_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    await idbRequest(
      transaction
        .objectStore(NEXT_SESSION_ATTEMPT_STORE)
        .put({ ...attempt, state: 'unknown_response' } satisfies NextSessionAttempt),
    );
    await completion;
  }

  public async acknowledgeNextSession(actorId: string, projectId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(NEXT_SESSION_ATTEMPT_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    await idbRequest(
      transaction.objectStore(NEXT_SESSION_ATTEMPT_STORE).delete(`${actorId}:${projectId}`),
    );
    await completion;
  }

  public async put(workflow: NewInterviewWorkflow): Promise<void> {
    assertWorkflow(workflow);
    const database = await this.database();
    const transaction = database.transaction(WORKFLOW_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    await idbRequest(
      transaction.objectStore(WORKFLOW_STORE).put({
        ...workflow,
        updatedAt: new Date().toISOString(),
      }),
    );
    await completion;
  }

  public async retire(workflow: NewInterviewWorkflow): Promise<void> {
    await this.put({ ...workflow, status: 'retired' });
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      open.onupgradeneeded = (): void => {
        const database = open.result;
        if (!database.objectStoreNames.contains(WORKFLOW_STORE)) {
          const workflows = database.createObjectStore(WORKFLOW_STORE, { keyPath: 'workflowId' });
          workflows.createIndex(ACTOR_INDEX, 'actorId', { unique: false });
        }
        if (!database.objectStoreNames.contains(SESSION_ATTEMPT_STORE)) {
          database.createObjectStore(SESSION_ATTEMPT_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(NEXT_SESSION_ATTEMPT_STORE)) {
          database.createObjectStore(NEXT_SESSION_ATTEMPT_STORE, { keyPath: 'key' });
        }
      };
      open.onerror = (): void => {
        reject(open.error ?? new Error('workflow database open failed'));
      };
      open.onblocked = (): void => {
        reject(new Error('workflow database upgrade blocked'));
      };
      open.onsuccess = (): void => {
        resolve(open.result);
      };
    });
    return this.databasePromise;
  }
}

export function prepareAttempt<Payload, Response>(
  payload: Payload,
): StableCreateAttempt<Payload, Response> {
  return {
    payload,
    requestId: globalThis.crypto.randomUUID(),
    response: null,
    state: 'prepared',
  };
}

export function canonicalWorkflowPayload(value: unknown): string {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalWorkflowPayload).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalWorkflowPayload(nested)}`)
      .join(',')}}`;
  }
  throw new TypeError('workflow payload must be JSON');
}

function assertWorkflow(value: NewInterviewWorkflow): void {
  if (
    value.workflowId.trim().length === 0 ||
    value.actorId.trim().length === 0 ||
    !['active', 'complete', 'retired'].includes(value.status)
  ) {
    throw new TypeError('invalid new interview workflow');
  }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => {
      resolve();
    };
    transaction.onerror = (): void => {
      reject(transaction.error ?? new Error('IndexedDB failed'));
    };
    transaction.onabort = (): void => {
      reject(transaction.error ?? new Error('IndexedDB aborted'));
    };
  });
}
