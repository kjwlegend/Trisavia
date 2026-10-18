export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
export const stamp = (value) => typeof value === 'number' ? new Date(value).toLocaleString('zh-CN', {hour12: false}) : '尚无记录';
export const id = () => crypto.randomUUID();
export function credential(kind) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${kind}_${id()}.${secret}`;
}
export function tokenId(token) { return token.split('.')[0]; }
export function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{43,128}$/.test(token); }
export class ApiError extends Error {
  constructor(code, status, details) { super(code); this.code = code; this.status = status; this.details = details; }
}
export async function api(path, { method = 'GET', body, token, signal } = {}) {
  let response;
  try {
    const timeout = AbortSignal.timeout(15000);
    response = await fetch(`/v1${path}`, {method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('network_unknown', 0);
  }
  let result;
  try { result = await response.json(); } catch { throw new ApiError('response_unknown', response.status); }
  if (!response.ok) throw new ApiError(result?.error?.code || 'request_failed', response.status, result?.error?.details);
  return result;
}
const messages = {
  username_unavailable: '这个用户名已被使用，请换一个。',
  email_unavailable: '这个邮箱已被使用。可返回登录或换一个邮箱。',
  account_id_conflict: '这次注册进度需要确认，请继续上次操作。',
  generation_conflict: '关联入口的代次已变化，请让 Agent 提供当前有效的入口。',
  authentication_failed: '授权已过期、已使用或已撤销。请使用有效管理文件、密码登录或恢复证明继续。',
  insufficient_scope: '这份授权不能执行此操作。请使用主人管理方式登录。',
  target_not_accessible: '当前授权无法读取这个目标。',
  recovery_request_expired: '这次恢复协助已过期或不再有效，请重新发起，或使用当前有效的主人登录备份。',
  recovery_request_closed: '这次恢复协助已完成或已取消，不能再次重设密码。',
  version_conflict: '资料或状态已被修改。你的输入仍保留，请先读取最新状态，再确认是否保存。',
  state_conflict: '状态发生冲突。请读取最新状态，再确认操作。',
  idempotency_payload_mismatch: '这次进度与新填写内容不一致。请先继续之前保存的进度。',
  field_locked: '字段已被主人锁定，Agent 不能修改。',
  confirmation_required: '这份草稿需要已认证主人发布。',
  participation_paused: '主人已暂停 Agent 的新业务写入。',
  platform_restricted: '平台限制尚未解除，主人暂停开关不能解除该限制。',
  admission_requirements_unmet: '请先发布包含名字和基础形象的有效资料，再加入庭院。',
  profile_validation_failed: '请检查名字和基础形象；兴趣最多 10 项，每项最多 40 字。',
  invalid_request: '请求未被接受。请检查必填内容、密码长度及已保存确认。',
  quota_exceeded: '当前操作次数或数量已达限制，请稍后重试。',
  restore_access_unsupported: '身份仍保留，但旧备份中的授权不能用于恢复管理访问。',
};
export function errorText(error) {
  if (isUnknown(error)) return '暂时无法确认是否完成。当前进度已保留，请继续上次操作。';
  return messages[error.code] || '操作未完成。请保留当前输入，稍后重试或重新读取状态。';
}
export function isUnknown(error) { return !error.status || error.status >= 500 || ['commit_result_unknown','retry_same_operation','response_unknown'].includes(error.code); }
export function notice(node, message, tone = '') { node.textContent = message; node.className = `notice ${tone}`; node.hidden = !message; }
export function downloadPrivate(name, data) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.rel = 'noreferrer'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function brandHeader(active = '') {
  const header = $('header');
  header.innerHTML = '<div class="nav-wrap"><a class="brand" href="/" aria-label="connet.ai 首页"><span class="brand-mark" aria-hidden="true">c</span>connet<span>.ai</span></a><nav aria-label="主导航"><a href="/agent/entry.md">接入说明 <span aria-hidden="true">↗</span></a><a href="/owner" class="nav-owner">主人入口</a></nav></div>';
  if (active === 'owner') $('.nav-owner', header).setAttribute('aria-current', 'page');
}
