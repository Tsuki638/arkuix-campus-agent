import type { WorkspaceTransport } from '../../contracts/Backend';
import type { CalendarService } from '../../contracts/Calendar';
import type { KeyValueStore, SpeechService } from '../../contracts/Ports';
import type { WorkspaceRuntime } from '../../bootstrap/WorkspaceRuntime';
import { BackendError, normalizeBackendUrl } from './BackendApiClient';
import { createRemoteWorkspace, importLocalWorkspace } from './RemoteWorkspace';
import { WorkspaceApi } from './WorkspaceApi';

export interface AccountUser { username: string; }

interface LoginSession { user: AccountUser; token: string; expiresAt: number; }
interface Credentials { username: string; password: string; deviceId: string; }
interface StoredSession { baseUrl: string; token: string; }

const SESSION_KEY: string = 'backend_session_v2';
const MIGRATION_KEY: string = 'backend_legacy_import_v2';

export class AccountConnection {
  private transport: WorkspaceTransport;
  private baseUrl: string;
  private store: KeyValueStore;
  private deviceId: string;
  private speech: SpeechService;
  private calendar: CalendarService;
  private onExpired: () => void;
  private api: WorkspaceApi | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(transport: WorkspaceTransport, baseUrl: string, store: KeyValueStore, deviceId: string,
    speech: SpeechService, calendar: CalendarService, onExpired: () => void) {
    this.transport = transport;
    this.baseUrl = normalizeBackendUrl(baseUrl);
    this.store = store;
    this.deviceId = deviceId;
    this.speech = speech;
    this.calendar = calendar;
    this.onExpired = onExpired;
  }

  isSignedIn(): boolean { return this.api !== null; }

  async restore(): Promise<AccountUser | null> {
    await this.pendingWrite;
    const raw: string = await this.store.get(SESSION_KEY);
    if (raw.length === 0) { return null; }
    let item: StoredSession;
    try { item = JSON.parse(raw) as StoredSession; }
    catch { return null; }
    if (item === null || item.baseUrl !== this.baseUrl || typeof item.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(item.token)) { return null; }
    const api: WorkspaceApi = this.useToken(item.token);
    try { return await api.account<AccountUser>('GET', '/me'); }
    catch (error) {
      if (this.api === null) { return null; }
      this.api = null;
      throw error;
    }
  }

  async signIn(username: string, password: string, register: boolean): Promise<AccountUser> {
    const credentials: Credentials = { username: username, password: password, deviceId: this.deviceId };
    const account: WorkspaceApi = new WorkspaceApi(this.transport, this.baseUrl);
    const session: LoginSession = await account.account<LoginSession>('POST', register ? '/register' : '/login',
      JSON.stringify(credentials));
    if (session === null || session.user === null || session.user === undefined ||
      typeof session.user.username !== 'string' || typeof session.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(session.token)) {
      throw new BackendError('BACKEND_RESPONSE', '服务器返回了无效的登录信息。');
    }
    const saved: StoredSession = { baseUrl: this.baseUrl, token: session.token };
    await this.saveSession(JSON.stringify(saved));
    this.useToken(session.token);
    return session.user;
  }

  async signOut(): Promise<void> {
    const api: WorkspaceApi | null = this.api;
    await this.saveSession('');
    this.api = null;
    if (api !== null) {
      try { await api.account<null>('POST', '/logout'); }
      catch (error) {
        if (error instanceof BackendError && (error.code === 'AUTH_EXPIRED' || error.code === 'AUTH_REQUIRED')) { return; }
        throw error;
      }
    }
  }

  openWorkspace(): Promise<WorkspaceRuntime> {
    return createRemoteWorkspace(this.requireSession(), this.speech, this.calendar);
  }

  async hasLegacyHistory(): Promise<boolean> {
    if (await this.store.get(MIGRATION_KEY) === this.baseUrl) { return false; }
    for (const key of ['backend_workspace_v1', 'sessions_v1', 'study_data_v1', 'calendar_data_v1']) {
      if ((await this.store.get(key)).length > 0) {
        return !(await this.requireSession().request<boolean>('GET', '/import'));
      }
    }
    return false;
  }

  async importLegacyHistory(): Promise<void> {
    await importLocalWorkspace(this.requireSession(), this.store, this.calendar);
    await this.store.set(MIGRATION_KEY, this.baseUrl);
  }

  private requireSession(): WorkspaceApi {
    const api: WorkspaceApi | null = this.api;
    if (api === null) { throw new BackendError('AUTH_REQUIRED', '请先登录。'); }
    return api;
  }

  private useToken(token: string): WorkspaceApi {
    const api: WorkspaceApi = new WorkspaceApi(this.transport, this.baseUrl, token, () => {
      if (this.api === api) {
        this.api = null;
        this.saveSession('').catch(() => {});
        this.onExpired();
      }
    });
    this.api = api;
    return api;
  }

  private saveSession(value: string): Promise<void> {
    const write: Promise<void> = this.pendingWrite.then(() => this.store.set(SESSION_KEY, value));
    this.pendingWrite = write.catch(() => {});
    return write;
  }
}
