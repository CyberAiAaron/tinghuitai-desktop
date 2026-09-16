  // ===== 弹窗的关闭方式统一（2026-09-12）=====
  // 以前有六种说法：×、取消、关闭、收起、data-close、还有一个什么都没有。
  // 现在只有两类：
  //   看的（信息、列表）→ 右上角 ×，Esc 关，点外面也关
  //   改的（有输入）→ 底部「取消 / 保存」，Esc = 取消，点外面不关（防手滑丢掉正在写的东西）
  const EDIT_DIALOGS = new Set(['dlg', 'dlg-fix', 'dlg-spk', 'meeting-notes']);
  function wireDialogs(){
    document.querySelectorAll('dialog').forEach(d => {
      if (d.__wired) return; d.__wired = true;
      const isEdit = EDIT_DIALOGS.has(d.id);
      // 右上角的 × 一律等于取消
      d.querySelectorAll('.archive-close, [data-x]').forEach(b => b.onclick = () => d.close('cancel'));
      // Esc：编辑类按取消走同一条路，保证副作用一致
      d.addEventListener('cancel', e => { e.preventDefault(); d.close('cancel'); });
      // 点外面：看的可以关，改的不关
      if (!isEdit) d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); });
    });
  }
  wireDialogs();
  // 后加进来的 dialog 也要接上
  new MutationObserver(() => wireDialogs()).observe(document.body, {childList:true});
