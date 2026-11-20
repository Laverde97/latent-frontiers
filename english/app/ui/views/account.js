/* =========================================================================
   account.js — "Account & profiles" view: local profiles (guest mode) and
   the optional personal account (sign-in, 18+, migration, sync, sign-out,
   delete).
   ========================================================================= */

import { h, nextId, announce } from '../dom.js';
import { t } from '../../i18n.js';
import { DEFAULT_PROFILE_ID } from '../../core/profiles.js';
import { exportState } from '../../core/store.js';

function card(id, title, ...children) {
  return h('section', { class: 'efl-card efl-card--wide', 'aria-labelledby': id }, h('h3', { class: 'efl-h3', id }, title), ...children);
}

export function renderAccount(ctx) {
  const root = h('div', { class: 'efl-account' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('acc.title')));
  root.append(profilesSection(ctx));
  root.append(accountSection(ctx));
  return root;
}

/* ---- local profiles --------------------------------------------------- */
function profilesSection(ctx) {
  const reg = ctx.profiles;
  const active = reg.activeId();
  const list = h('ul', { class: 'efl-plain efl-profiles', 'data-testid': 'profiles' });
  reg.list().forEach((p) => {
    const isActive = p.id === active;
    const row = h('li', { class: `efl-profile${isActive ? ' is-active' : ''}`, 'data-profile': p.id },
      h('strong', null, p.name), isActive ? h('span', { class: 'efl-status efl-status--completed' }, ` ${t('acc.activeProfile')}`) : null,
      p.account ? h('span', { class: 'efl-small efl-muted' }, ` · ${t('acc.linkedTo', { email: p.account.email || '—' })}`) : h('span', { class: 'efl-small efl-muted' }, ` · ${t('acc.guest')}`));
    if (!isActive) {
      row.append(' ', h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', 'data-testid': `use-profile-${p.id}`, onclick: () => ctx.switchProfile(p.id) }, t('acc.useProfile')));
    }
    row.append(' ', h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', onclick: () => {
      const name = window.prompt(t('acc.renamePrompt'), p.name);
      if (name == null) { return; }
      try { reg.rename(p.id, name); ctx.go('account'); } catch (e) { window.alert(t('acc.invalidName')); }
    } }, t('acc.rename')));
    if (p.id !== DEFAULT_PROFILE_ID) {
      row.append(' ', h('button', { type: 'button', class: 'efl-btn efl-btn--danger', 'data-testid': `delete-profile-${p.id}`, onclick: () => {
        if (!window.confirm(t('acc.deleteProfileConfirm', { name: p.name }))) { return; }
        reg.remove(p.id);
        if (isActive) { ctx.reloadApp(); } else { ctx.go('account'); }
      } }, t('acc.deleteProfile')));
    }
    list.append(row);
  });
  const nameId = nextId('pn');
  const input = h('input', { id: nameId, class: 'efl-input', maxlength: '30', 'data-testid': 'new-profile-name', autocomplete: 'off' });
  const msg = h('p', { class: 'efl-small', 'aria-live': 'polite' });
  const add = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'create-profile' }, t('acc.createProfile'));
  add.addEventListener('click', () => {
    try {
      const p = reg.create(input.value);
      if (window.confirm(t('acc.switchNow', { name: p.name }))) { ctx.switchProfile(p.id); } else { ctx.go('account'); }
    } catch (e) { msg.textContent = t('acc.invalidName'); }
  });
  return card('acc-profiles', t('acc.profilesTitle'),
    h('p', { class: 'efl-small' }, t('acc.profilesHelp')),
    list,
    h('div', { class: 'efl-row efl-row--wrap' }, h('label', { for: nameId }, t('acc.newProfileName')), input, add), msg);
}

/* ---- personal account --------------------------------------------------- */
function accountSection(ctx) {
  const acc = ctx.account;
  const body = h('div', { 'data-testid': 'account-panel', 'aria-live': 'polite' });
  const sec = card('acc-account', t('acc.accountTitle'),
    h('p', { class: 'efl-small' }, t('acc.accountWhy')),
    h('ul', { class: 'efl-small' }, ['p1', 'p2', 'p3', 'p4'].map((k) => h('li', null, t(`acc.${k}`)))),
    body);

  if (!ctx.auth.configured) {
    body.append(h('p', { class: 'efl-notice', role: 'note', 'data-testid': 'accounts-not-configured' }, t('acc.notConfigured')));
    return sec;
  }
  if (!ctx.auth.client) {
    body.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'alert' }, t('acc.loadFailed')));
    return sec;
  }

  const phase = acc.phase;
  if (!ctx.auth.user || phase === 'signed-out' || phase === 'deleted') {
    if (phase === 'deleted') { body.append(h('p', { class: 'efl-ok', role: 'status' }, t('acc.deletedDone'))); }
    body.append(signInForm(ctx));
    return sec;
  }

  const user = ctx.auth.user;
  body.append(h('p', null, t('acc.signedInAs'), ' ', h('strong', { 'data-testid': 'signed-in-email' }, user.email || '—')));

  if (phase === 'needs-adult') {
    const id = nextId('adult');
    const cb = h('input', { type: 'checkbox', id, 'data-testid': 'adult-confirm-late' });
    const go = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'adult-confirm-btn' }, t('acc.activateSync'));
    go.addEventListener('click', async () => {
      if (!cb.checked) { announce(t('acc.adultRequired')); return; }
      go.disabled = true;
      try { await acc.confirmAdult(); } catch (e) { go.disabled = false; window.alert(t('acc.genericError', { msg: e.message })); }
    });
    body.append(h('p', null, t('acc.needsAdult')), h('p', { class: 'efl-check-row' }, cb, h('label', { for: id }, ` ${t('acc.adultLabel')}`)), go,
      signOutButtons(ctx, false));
  } else if (phase === 'choose') {
    body.append(migrationChoice(ctx));
  } else if (phase === 'linked-elsewhere') {
    body.append(h('p', null, t('acc.linkedElsewhere', { name: acc.otherProfile.name })),
      h('button', { type: 'button', class: 'efl-btn efl-btn--primary', onclick: () => ctx.switchProfile(acc.otherProfile.id) }, t('acc.useProfile')));
  } else if (phase === 'profile-has-other-account') {
    body.append(h('p', { class: 'efl-warn' }, t('acc.profileOtherAccount')), signOutButtons(ctx, false));
  } else if (phase === 'error') {
    body.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'alert' }, t('acc.genericError', { msg: acc.error && acc.error.message })),
      h('button', { type: 'button', class: 'efl-btn', onclick: () => acc.handleUser(ctx.auth.user) }, t('acc.retry')));
  } else if (phase === 'linked') {
    const last = acc.lastSyncedAt();
    body.append(
      h('p', null, t('acc.linkedProfile', { name: ctx.profiles.active().name })),
      h('p', { 'data-testid': 'sync-status' }, t(`sync.${acc.status}`), last ? h('span', { class: 'efl-small efl-muted' }, ` · ${t('acc.lastSync', { when: new Date(last).toLocaleString() })}`) : null),
      acc.lastBackup ? h('p', { class: 'efl-small efl-muted' }, t('acc.backupKept')) : null,
      h('div', { class: 'efl-row efl-row--wrap' },
        h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'sync-now', onclick: async () => { await acc.syncNow(); ctx.go('account'); } }, t('acc.syncNow')),
        h('button', { type: 'button', class: 'efl-btn', onclick: () => download(ctx) }, t('set.export'))),
      signOutButtons(ctx, true),
      deleteAccountBox(ctx));
  } else {
    body.append(h('p', null, t('loading')));
  }
  return sec;
}

function signInForm(ctx) {
  const wrap = h('div', { class: 'efl-signin' });
  const emailId = nextId('em');
  const adultId = nextId('ad');
  const termsId = nextId('tr');
  const email = h('input', { id: emailId, type: 'email', class: 'efl-input', autocomplete: 'email', 'data-testid': 'signin-email', required: true });
  const adult = h('input', { id: adultId, type: 'checkbox', 'data-testid': 'signin-adult' });
  const terms = h('input', { id: termsId, type: 'checkbox', 'data-testid': 'signin-terms' });
  const msg = h('p', { class: 'efl-small', role: 'status', 'data-testid': 'signin-msg' });
  const send = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'signin-send' }, t('acc.sendCode'));
  const codeBox = h('div', { hidden: true });
  const codeId = nextId('cd');
  const code = h('input', { id: codeId, class: 'efl-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '10', 'data-testid': 'signin-code' });
  const verify = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'signin-verify' }, t('acc.verify'));
  codeBox.append(h('p', null, t('acc.codeSent')), h('label', { for: codeId }, t('acc.codeLabel')), ' ', code, ' ', verify);

  send.addEventListener('click', async () => {
    msg.className = 'efl-small';
    if (!adult.checked) { msg.className = 'efl-warn efl-small'; msg.textContent = t('acc.adultRequired'); return; }
    if (!terms.checked) { msg.className = 'efl-warn efl-small'; msg.textContent = t('acc.termsRequired'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { msg.className = 'efl-warn efl-small'; msg.textContent = t('acc.invalidEmail'); return; }
    send.disabled = true;
    try {
      ctx.account.rememberAdultIntent(email.value.trim());
      await ctx.auth.sendCode(email.value.trim());
      msg.textContent = '';
      codeBox.hidden = false;
      code.focus();
    } catch (e) {
      msg.className = 'efl-bad efl-small';
      msg.textContent = t('acc.genericError', { msg: e.message });
    } finally { send.disabled = false; }
  });
  verify.addEventListener('click', async () => {
    verify.disabled = true;
    try {
      await ctx.auth.verifyCode(email.value.trim(), code.value.trim());
    } catch (e) {
      msg.className = 'efl-bad efl-small';
      msg.textContent = t('acc.badCode');
    } finally { verify.disabled = false; }
  });

  wrap.append(
    h('div', { class: 'efl-field' }, h('label', { for: emailId }, t('acc.email')), email),
    h('p', { class: 'efl-check-row' }, adult, h('label', { for: adultId }, ` ${t('acc.adultLabel')}`)),
    h('p', { class: 'efl-small efl-muted' }, t('acc.minorsNote')),
    h('p', { class: 'efl-check-row' }, terms, h('label', { for: termsId }, ` ${t('acc.termsLabel')}`)),
    h('details', { class: 'efl-model' }, h('summary', null, t('acc.dataTitle')), h('ul', { class: 'efl-small' }, ['d1', 'd2', 'd3', 'd4', 'd5'].map((k) => h('li', null, t(`acc.${k}`))))),
    send, msg, codeBox);
  return wrap;
}

function migrationChoice(ctx) {
  const acc = ctx.account;
  const p = acc.pending;
  const s = (x) => (x ? t('acc.summary', x) : t('acc.summaryEmpty'));
  const box = h('div', { class: 'efl-callout', 'data-testid': 'migration' },
    h('h4', null, t('acc.migrationTitle')),
    h('p', null, t('acc.migrationHelp')),
    h('ul', null, h('li', null, h('strong', null, t('acc.thisBrowser')), ' ', s(p.local)), h('li', null, h('strong', null, t('acc.theAccount')), ' ', s(p.remoteSummary))));
  const act = (choice, testid, label, primary, confirmKey) => {
    const b = h('button', { type: 'button', class: `efl-btn${primary ? ' efl-btn--primary' : ''}`, 'data-testid': testid }, label);
    b.addEventListener('click', async () => {
      if (confirmKey && !window.confirm(t(confirmKey))) { return; }
      if (choice === 'replace-account' && !window.confirm(t('acc.replaceConfirm2'))) { return; }
      b.disabled = true;
      try { await acc.link(p.user, choice); } catch (e) { b.disabled = false; window.alert(t('acc.genericError', { msg: e.message })); }
    });
    return b;
  };
  if (p.remote) {
    box.append(h('div', { class: 'efl-row efl-row--wrap' },
      act('merge', 'mig-merge', t('acc.merge'), true),
      act('use-account', 'mig-use-account', t('acc.useAccount'), false, 'acc.useAccountConfirm'),
      act('replace-account', 'mig-replace', t('acc.replaceAccount'), false, 'acc.replaceConfirm1')));
  } else {
    box.append(h('div', { class: 'efl-row efl-row--wrap' },
      act('upload', 'mig-upload', t('acc.upload'), true),
      act('new-profile', 'mig-new-profile', t('acc.newProfileForAccount'), false)));
  }
  box.append(h('p', { class: 'efl-small efl-muted' }, t('acc.backupNote')), signOutButtons(ctx, false));
  return box;
}

function signOutButtons(ctx, linked) {
  const keep = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'signout-keep' }, linked ? t('acc.signOutKeep') : t('acc.signOut'));
  keep.addEventListener('click', async () => { await ctx.account.signOut(true); ctx.go('account'); });
  const row = h('div', { class: 'efl-row efl-row--wrap' }, keep);
  if (linked) {
    const wipe = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', 'data-testid': 'signout-clear' }, t('acc.signOutClear'));
    wipe.addEventListener('click', async () => {
      if (!window.confirm(t('acc.signOutClearConfirm'))) { return; }
      await ctx.account.signOut(false);
      ctx.go('account');
    });
    row.append(wipe);
  }
  return row;
}

function deleteAccountBox(ctx) {
  const id = nextId('del');
  const input = h('input', { id, class: 'efl-input', autocomplete: 'off', 'data-testid': 'delete-confirm-text' });
  const btn = h('button', { type: 'button', class: 'efl-btn efl-btn--danger', 'data-testid': 'delete-account' }, t('acc.deleteAccount'));
  const msg = h('p', { class: 'efl-small', role: 'status' });
  btn.addEventListener('click', async () => {
    if (input.value.trim().toUpperCase() !== t('acc.deleteWord')) { msg.className = 'efl-warn efl-small'; msg.textContent = t('acc.deleteTypeWord', { word: t('acc.deleteWord') }); return; }
    btn.disabled = true;
    try { await ctx.account.deleteAccount(true); ctx.go('account'); } catch (e) { btn.disabled = false; msg.className = 'efl-bad efl-small'; msg.textContent = t('acc.genericError', { msg: e.message }); }
  });
  return h('details', { class: 'efl-model efl-danger-zone' }, h('summary', null, t('acc.deleteTitle')),
    h('p', { class: 'efl-small' }, t('acc.deleteHelp')),
    h('div', { class: 'efl-row efl-row--wrap' }, h('label', { for: id }, t('acc.deleteTypeWord', { word: t('acc.deleteWord') })), input, btn), msg);
}

function download(ctx) {
  const blob = new Blob([exportState(ctx.store.state)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `english-fluency-lab-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

