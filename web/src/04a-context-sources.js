  // ===== 本场可配置 Context 来源 =====
  let contextProjectId = '';
  let contextSourceIds = [];
  let contextRegistry = {version:0, sources:[]};
  try {
    contextProjectId = localStorage.getItem('tht-project-id') || '';
    const saved = JSON.parse(localStorage.getItem('tht-context-source-ids') || '[]');
    if (Array.isArray(saved)) contextSourceIds = saved.filter(x => typeof x === 'string').slice(0, 40);
  } catch(e) {}

  const contextApiUrl = () => `${relayBase()}/context-sources?token=${encodeURIComponent(cfg.relayToken || '')}`;
  const contextHeaders = () => ({'content-type':'application/json', 'x-tht-token':cfg.relayToken || ''});
  const contextStatusText = status => {
    if (!status) return '未检查';
    if (status.state === 'ready') return `可用 · ${status.modifiedAt ? new Date(status.modifiedAt).toLocaleString() : '未知版本'}`;
    if (status.state === 'missing') return '找不到';
    if (status.state === 'type-mismatch') return '类型不匹配';
    return '读不了';
  };
  function persistContextPreferences(){
    contextProjectId = ($('#s-project')?.value || '').trim().slice(0, 80);
    try {
      localStorage.setItem('tht-project-id', contextProjectId);
      localStorage.setItem('tht-context-source-ids', JSON.stringify(contextSourceIds));
    } catch(e) {}
  }
  function renderContextSources(){
    const list = $('#s-context-sources'); if (!list) return;
    list.replaceChildren();
    const rows = contextRegistry.sources || [];
    const overview = $('#s-context-overview');
    if (overview) overview.textContent = `来源表 v${contextRegistry.version || 1} · ${rows.filter(x => x.status?.available).length}/${rows.length} 可用 · 本场已选 ${contextSourceIds.length}`;
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'context-source-empty';
      empty.textContent = '还没有本机来源。添加文件或目录后，勾选的来源会随本场会议启动。'; list.append(empty); return;
    }
    for (const source of rows) {
      const row = document.createElement('div'); row.className = 'context-source-row'; row.dataset.sourceId = source.id;
      const choose = document.createElement('input'); choose.type = 'checkbox'; choose.className = 'context-source-select';
      choose.checked = contextSourceIds.includes(source.id); choose.setAttribute('aria-label', '本场使用 '+source.title);
      choose.onchange = () => {
        const selected = new Set(contextSourceIds); choose.checked ? selected.add(source.id) : selected.delete(source.id);
        contextSourceIds = [...selected].slice(0, 40); persistContextPreferences();
      };
      const info = document.createElement('div'); info.className = 'context-source-info';
      const title = document.createElement('strong'); title.textContent = source.title;
      const detail = document.createElement('span'); detail.textContent = `${source.type === 'directory' ? '目录' : '文件'} · ${source.scope === 'global' ? '所有项目' : (source.projectId || '未分类')} · ${contextStatusText(source.status)}`;
      const sourcePath = document.createElement('code'); sourcePath.textContent = source.path;
      info.append(title, detail, sourcePath);
      const actions = document.createElement('div'); actions.className = 'context-source-actions';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn sm'; toggle.dataset.contextAction = 'toggle';
      toggle.textContent = source.enabled ? '停用' : '启用'; toggle.title = source.enabled ? '暂停读取这个来源' : '恢复读取这个来源';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn sm'; remove.dataset.contextAction = 'delete'; remove.textContent = '删除';
      actions.append(toggle, remove); row.append(choose, info, actions); list.append(row);
    }
  }
  async function contextApi(body){
    const r = await fetch(contextApiUrl(), {method:body?'POST':'GET', headers:body?contextHeaders():{'x-tht-token':cfg.relayToken || ''}, ...(body?{body:JSON.stringify(body)}:{}), cache:'no-store'});
    const result = await r.json().catch(()=>({}));
    if (!r.ok || !result.ok) throw Error(result.error || '本机来源连接失败');
    contextRegistry = result; renderContextSources(); return result;
  }
  async function loadContextSources(){
    const msg = $('#s-context-msg'); if (msg) msg.textContent = '正在读本机来源…';
    try { await contextApi(); if (msg) msg.textContent = ''; }
    catch(e) { contextRegistry = {version:0,sources:[]}; renderContextSources(); if (msg) msg.textContent = e.message; }
  }
  $('#s-context-add').onclick = async () => {
    const button = $('#s-context-add'), sourcePath = $('#s-context-path').value.trim(), title = $('#s-context-title').value.trim();
    if (!sourcePath) { $('#s-context-msg').textContent = '先填文件或目录路径。'; return; }
    const scope = $('#s-context-scope').value;
    const projectId = ($('#s-project').value || '').trim();
    if (scope === 'project' && !projectId) { $('#s-context-msg').textContent = '项目来源需要先填项目 ID。'; return; }
    button.disabled = true;
    try {
      const before = new Set((contextRegistry.sources || []).map(x=>x.id));
      const result = await contextApi({action:'upsert', source:{title, path:sourcePath, type:$('#s-context-type').value, scope, projectId, enabled:true, recursive:true}});
      const added = (result.sources || []).find(x=>!before.has(x.id)); if (added && !contextSourceIds.includes(added.id)) contextSourceIds.push(added.id);
      $('#s-context-path').value = ''; $('#s-context-title').value = ''; $('#s-context-msg').textContent = '已添加并选为本场来源。'; persistContextPreferences(); renderContextSources();
    } catch(e) { $('#s-context-msg').textContent = e.message; } finally { button.disabled = false; }
  };
  $('#s-context-sources').onclick = async event => {
    const button = event.target.closest('[data-context-action]'); if (!button) return;
    const row = button.closest('[data-source-id]'), source = (contextRegistry.sources || []).find(x=>x.id===row?.dataset.sourceId); if (!source) return;
    button.disabled = true;
    try {
      if (button.dataset.contextAction === 'delete') {
        await contextApi({action:'delete', id:source.id}); contextSourceIds = contextSourceIds.filter(id=>id!==source.id); persistContextPreferences(); renderContextSources();
      } else await contextApi({action:'toggle', id:source.id, enabled:!source.enabled});
      $('#s-context-msg').textContent = '';
    } catch(e) { $('#s-context-msg').textContent = e.message; } finally { button.disabled = false; }
  };

  const meetingContextPayload = session => ({
    projectId: String(session?.projectId ?? contextProjectId ?? '').trim().slice(0, 80),
    contextSourceIds: [...new Set(Array.isArray(session?.contextSourceIds) ? session.contextSourceIds : contextSourceIds)].slice(0, 40),
  });
