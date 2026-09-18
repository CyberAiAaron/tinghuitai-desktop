  // ===== 界面语言（中 / EN）=====
  const I18N = {
    zh:{}, // zh 用 HTML 里的原文
    en:{
      unverified:'Grounded · rate it',speaker_count:'Known speaker count (0 = estimate)',asr_engine:'Recorded audio engine',local_asr:'On this Mac · transcription & speaker separation',cloud_asr:'On this Mac · transcribe and archive to Feishu',asr_hint:'Local results appear in Workspace. Speaker IDs need manual naming.',work_hub:'Workspace',tasks:'Tasks',save_hub:'Save to workspace',meeting_tasks:'Meeting tasks',close:'Close',task_hint:'Keep action items separate. Save to your workspace to manage projects, owners and progress.',brand:'Meeting LiveMate', tagline:'Your live meeting companion',
      m_auto:'Auto (Mac online → Volc, offline → IME)', m_asr:'Volcano ASR (via Mac, best)',
      m_tab:'Online meeting - in browser (tab audio + mic)', m_ime:'IME dictation (WeChat / Doubao)', m_browser:'Browser recognition',
      b_pull:'Pull from Mac', pull_wait:'Pulling from Mac...', pull_ok:'Restored ', pull_ok2:' session(s).',
      pull_none:'Nothing on the Mac that this device is missing.', pull_fail:'Could not pull: ', pull_fail2:' (is your Mac online?)',
      e_hist:'No sessions on this device yet - try "Pull from Mac".',
      m_sys:'Online meeting - desktop app (aggregate device + mic)', f_mic:'Audio input device (pick the aggregate device for desktop-app calls)',
      mic_default:'System default', mic_hint:'For desktop-app calls pick "Aggregate device (BlackHole + mic)" so the other side is heard.',
      mic_nolabel:'Allow microphone once so device names show up.',
      src_sys2:'Aggregate device, 2 tracks -> Volcano (L = others, R = me)', src_sys1:'Aggregate device, mono -> Volcano (no speaker split)',
      src_tab:'Tab audio + mic -> Volcano (splits Others / Me)', spk_all:' (applies to the whole session)',
      t_mix:'Chinese + English', t_zh:'Chinese only', t_en:'English only', f_tongue:'Recognition language (changeable mid-meeting)',
      sh_arch:'Save as document', arch_hint:'Ark on your Mac creates the doc and DMs you the link. Mac must be online.',
      arch_lark:'Save to Lark Doc', arch_notion:'Save to Notion',
      b_mkdoc:'Create minutes', b_import:'Import transcript', b_brief:'Context',
      sh_brief:'Context for this meeting', brief_hint:'Who is here, which company, website, product names. These go to the recognizer (fewer mis-hearings) and to the analysis (fewer wrong calls). Editable mid-meeting.',
      brief_lbl:'One per line', brief_fix:'Corrections (misheard -> correct, one per line, use -> or =)',
      brief_saved:'Saved, ', brief_saved2:' words added to recognition hotwords.', brief_reconn:' Applied to this session.',
      fix_title:'Edit this item', fix_text:'Text', fix_verdict:'Verdict', fix_note:'Note',
      fix_word:'Correct this word throughout the meeting (optional)', fix_del:'Delete it', fix_ok:'Updated.', fix_del_ok:'Deleted.', b_full:'Full minutes MD', b_verb:'Verbatim MD', b_pdf:'Save as PDF', b_share2:'Post to #ai-native-hw', grp_exp:'EXPORT', grp_share:'SHARE', grp_other:'OTHER',
      grp_imp:'IMPORT', sh_imp:'Analyze an existing transcript', imp_title:'Meeting name', imp_file:'Pick a file (.txt / .md / .vtt / .srt / .csv)',
      imp_text:'Or paste it here', imp_go:'Analyze', imp_read:'Loaded ', imp_busy:'A session is running - end it first.',
      imp_empty:'Nothing to read - paste text or pick a file.', imp_untitled:'Imported transcript',
      imp_ok:'Created a session: ', imp_ok2:' lines. Sending to the Mac for notes, to-dos, fact-checks and the deep summary...',
      imp_up_ok:'Handed to the Mac. The deep summary lands in the group shortly, then it will DM you about sharing.',
      imp_up_fail:'Upload failed - it will retry automatically.', imp_local:'Mac offline - analyzing on this device...',
      imp_local_ok:'Local analysis done. The deep version will be filed once the Mac is back.',
      imp_nokey:'Mac offline and no analysis key set - only stored locally.',
      dl_full:'Exported full minutes (verbatim + highlights + to-dos + fact-checks).',
      dl_verb:'Exported verbatim transcript only.',
      pdf_hint:'Choose "Save as PDF" in the print panel.',
      share_queued:'Submitted. Ark will create both docs and DM you the Slack draft first \u2014 it only posts after you reply.',
      noSession:'No session yet.',
      arch_both:'Create minutes (Lark + Notion)', arch_queued2:'Submitted. Ark will DM you both links (1-3 min).',
      sh_resume:'Last session is still open', resume_go:'Continue it', resume_end:'End it, start a new one',
      resume_ended:'Previous session ended. Tap Start to begin a new one.', sh_more:'More',
      f_adv:'Advanced (rarely needed)', f_mode:'Recognition method',
      h_mode:'Lark online meetings need no choice here \u2014 the Mac side reads Lark\u2019s own transcript with real names.',
      arch_notoken:'Set the Mac relay token in Settings first.', arch_wait:'Submitting…', arch_done:'Created: ',
      arch_queued:'Submitted. Ark will DM you the link (1-3 min).', arch_fail:'Failed: ', arch_fail2:' (is your Mac online?)',
      dl_done:'Exported as a web page - readable on the phone, forwardable as is.',
      start:'Start', stop:'End & summarize',
      tab_tr:'Transcript', tab_hl:'Notes', tab_ck:'Views',
      h_tr:'Transcript', h_hl:'Notes', h_ck:'Views',
      ph_ime:'Tap here → keyboard mic → talk. Text moves into the transcript 2.5s after you pause.',
      jump:'↓ Latest',
      sh_mode:'Meeting type', t_auto:'Detect automatically (recommended)', t_id:'Bahasa Indonesia', t_pt:'Português do Brasil', t_es:'Español',
      fix_word:'One word was misheard (optional)', fix_word_hint:'Once filled in, that word is corrected automatically for the rest of this meeting.', fix_why:'It misunderstood — tell it in one line (optional)', fix_why_keep:'Apply this in future meetings too', fix_why_hint:'This line becomes a rule for the assistant and shapes later analysis; leave the box unticked to keep it to this meeting.',
      b_meetings:'Past meetings', b_settings:'Settings', f_asr_way:'Transcription', f_llm_way:'Model that writes the note',
      b_sum:'Meeting notes', link_setup:'Speech and model settings ↗', st_idle:'Idle', sum_empty:'Appears here after the meeting ends.', mode_hint:'Pick how this meeting happens. While recording it shows the actual mode; you can change it afterwards.', kind_title:'How is this meeting happening?', k_test:'Test it first (10s)', k_live_t:'In person', k_live_d:'Put the Mac on the table and let it hear the room.', k_on_t:'Online (just me at my desk)', k_on_d:'Captures the meeting audio and your own voice. Noise suppression is on, so nearby chatter is not recorded. Chrome will ask you to pick the meeting tab — remember to tick \u201cAlso share tab audio\u201d.', k_room_t:'Online + in person (others in the room)', k_room_d:'Meeting audio plus the whole room. Noise suppression off, so anyone in the room is picked up. Muting yourself in the meeting app makes no difference.', b_memory:'What it remembers',rv_label:'Reviewing',rv_note:'Notes / download & share',rv_exit:'Back to current',fix_say:'Fix it, or have Claude act on it — say it in one line',fix_say_hint:'Reword it, change the call, drop it, teach it a misheard word, or set a standing rule — say which and it does it, then tells you what it changed. Undoable.',fix_go:'Fix it',fix_detail:'Do it myself (details)',fm_edit:'Fix record',fm_task:'Hand off',fix_say_ph:"e.g. not the same difficulty, the web is far easier than the app / he said What's the post / from now on don't read 可以考虑 as a decision",b_this:'This meeting', g_send:'Send it', g_save:'Save on this Mac', g_ctx:'Help it understand this meeting', s_lark:'Feishu', b_notes:'Material', b_arch:'Meeting archive', b_backup:'Audio backups', b_more:'More', b_update:'Check for updates', b_feedback:'Feedback / contact', b_mode:'Meeting type', b_resume:'Resume last', b_share:'Save as doc', b_copy:'Copy Markdown', b_export:'Export web page', b_hist:'Past meetings', b_clear:'Clear session',
      sh_sum:'Closing summary', sh_hist:'Past sessions', close:'Close',
      dlg_settings:'Settings', f_relay:'Mac relay token (for Volcano ASR / multi-screen)', f_hot:'Hotwords (comma separated)',
      f_provider:'Analysis model (runs on this device when Mac is offline)', f_key:'API key',
      f_models:'In-meeting model / summary model', f_auto:'Browser recognition: end after N minutes without text',
      f_ctx:'Project context (only fed to in-meeting analysis)',
      b_test:'Test connection', cancel:'Cancel', save:'Save', dlg_spk:'Name this speaker',
      // 运行时字符串
      st_idle:'Idle', st_mac:'Mac online', st_view:'Mirroring', st_live:'Listening', st_ended:'Ended',
      st_analyzing:'Analyzing', st_summing:'Summarizing', st_waitmac:'Waiting for Mac summary',
      e_tr:'Tap “Start”, put the phone on the table. Keep this page in the foreground and the device awake. Locking a phone or switching apps may pause audio capture.',
      e_tr_live:'Listening…', e_tr_none:'Nothing in this session yet.',
      e_hl:'Analyzed about every 25s. Conflicts in red, to-dos in green.',
      e_ck:'Likely right / may be wrong / worth knowing, plus free-form reminders — checked against the project state, each with a quote. Nothing here means nothing worth saying yet.',
      e_sum:'Appears here after the session ends.', e_hist:'No sessions on this device yet.',
      v_true:'likely true', v_false:'likely wrong', v_unsure:'not sure',
      unfinished:'unfinished', sent:'lines', notes:'notes', checks:'checks', pending:'pending upload',
      src_mic:'Device mic → Volcano ASR', src_tab:'Tab audio + mic → Volcano ASR', src_ime:'IME dictation', src_browser:'Browser recognition',
      mtitle:'Meeting', dl_confirm:'OK = web page (nicely formatted, opens on phone, shareable)\nCancel = Markdown (paste into Lark / Notion with formatting)',
      copied:'Copied Markdown — paste into Lark / Notion and it keeps formatting.',
      langSwitched:'Recognition language: ', uiSwitched:'Interface switched to English. New notes and checks will come out in English.',
      firstUse:'First run: tap ⚙︎ to fill in the Mac relay token and DeepSeek key (stored on this device only).',
      needRelay:'Volcano ASR needs the Mac relay token. Fill it in ⚙︎.', needKey:'When the Mac is offline the in-meeting analysis needs a DeepSeek key.',
      clearConfirm:'Delete this session’s transcript and analysis?',
      resumeConfirm:'The last session never ended. Continue recording it? Cancel marks it as ended.',
      histRunning:'This session is live — check history after it ends.',
      histFixed:'That session never ended properly; its end time was set to the last line. You can export it now.',
      imeLang:'Switch the IME’s own language in the keyboard.',
      sameSession:'’, same session continues.'
    }
  };
  let archiveAttention=0;
  // 界面语言跟随系统，用户手动切过就以他的选择为准。之前无论系统什么语言都默认中文，
  // 英文用户打开第一眼全是中文，直接劝退。
  const sysUi = (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  let ui = sysUi; try { ui = localStorage.getItem('tht-ui') || sysUi; } catch(e){}
  let hlPaintedFor = null;   // 每场会只在首次渲染时把要点滚到底，之后不抢用户的滚动位置
  // 换到另一场时清掉这个标记，让新那场的要点也滚到底一次。
  // 以前这里调的是 resetPaint()，但全项目没有这个函数，于是「继续这场」一点就抛错、后面什么都不执行。
  function resetPaint(){ hlPaintedFor = null; }
  const T = k => (ui === 'en' && I18N.en[k]) ? I18N.en[k] : null;
  // 识别语言默认值按界面语言推断（本人 09-05 定第2项，听会台-12/-16）：
  // UI 为 en 时默认只识别英文；UI 为 zh 时维持现状（中英混说）。可被 local-ready.json 的 defaultTongueByUi 覆盖。
  let localReadyCfg = {};
  try { fetch('./local-ready.json').then(r => r.ok ? r.json() : {}).then(j => { localReadyCfg = j || {}; }).catch(()=>{}); } catch(e){}
  function defaultTongueForUi(){
    return 'mix';
  }
  const zhCache = new Map();
  function applyI18n(){
    document.querySelectorAll('[data-i18n]').forEach(n => {
      const k = n.dataset.i18n; if (!zhCache.has(k)) zhCache.set(k, n.textContent);
      n.textContent = ui === 'en' ? (I18N.en[k] || zhCache.get(k)) : zhCache.get(k);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(n => {
      const k = n.dataset.i18nPh; if (!zhCache.has('ph:'+k)) zhCache.set('ph:'+k, n.placeholder);
      n.placeholder = ui === 'en' ? (I18N.en[k] || zhCache.get('ph:'+k)) : zhCache.get('ph:'+k);
    });
    document.documentElement.lang = ui === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('#ui-lang button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ui === ui)));
    updateFooterLabels();resetSigs(); render(); updateStatusIdle(); try { updateModeChip(); renderModeList(); updateReadyBar(); renderPostCards(); } catch(e){}
  }

