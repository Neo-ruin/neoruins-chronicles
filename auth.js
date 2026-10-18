/* NEORUINS Observer Auth — shared library
   Include on every page that needs accounts:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="auth.js"></script>
*/
const SUPABASE_URL = 'https://jnpbaspcgitqesgqfxsa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_po0qZwjZKpMisGtOP8fSbw_q1n6KoLD';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ObserverAuth = {
  client: _sb,
  user: null,
  profile: null,

  async init() {
    const { data: { session } } = await _sb.auth.getSession();
    this.user = session?.user || null;
    if (this.user) await this.loadProfile();
    _sb.auth.onAuthStateChange(async (event, session) => {
      this.user = session?.user || null;
      if (this.user) await this.loadProfile();
      else this.profile = null;
      document.dispatchEvent(new CustomEvent('observer-auth-change', { detail: { user: this.user } }));
    });
    return this.user;
  },

  async signIn(email) {
    const { error } = await _sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    return error;
  },

  async signOut() {
    await _sb.auth.signOut();
    this.user = null;
    this.profile = null;
  },

  async loadProfile() {
    if (!this.user) return null;
    const { data, error } = await _sb
      .from('observer_profiles')
      .select('*')
      .eq('id', this.user.id)
      .single();
    if (!error) {
      this.profile = data;
    } else {
      // Self-heal: create profile if the signup trigger missed it
      const { data: created } = await _sb
        .from('observer_profiles')
        .upsert({ id: this.user.id }, { onConflict: 'id' })
        .select()
        .single();
      if (created) this.profile = created;
    }
    return this.profile;
  },

  async setCodename(codename) {
    if (!this.user) return null;
    const clean = codename.trim().toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,20);
    if (!clean) return null;
    const { data, error } = await _sb
      .from('observer_profiles')
      .upsert({ id: this.user.id, codename: clean }, { onConflict: 'id' })
      .select()
      .single();
    this._lastCodenameError = error ? (error.message || String(error)) : null;
    if (!error) this.profile = data;
    return error ? null : data;
  },

  // --- Progress tracking ---
  async recordVaultUnlock(vaultNumber) {
    if (!this.user) return null;
    const { data, error } = await _sb
      .from('vault_unlocks')
      .upsert({ user_id: this.user.id, vault_number: vaultNumber }, { onConflict: 'user_id,vault_number' })
      .select();
    return error ? null : data;
  },

  async claimRelicCard(relicNumber) {
    if (!this.user) return null;
    const { data, error } = await _sb
      .from('relic_cards')
      .upsert({ user_id: this.user.id, relic_number: relicNumber }, { onConflict: 'user_id,relic_number' })
      .select();
    return error ? null : data;
  },

  async recordDiscovery(discovery) {
    if (!this.user) return null;
    const { data, error } = await _sb
      .from('terminal_discoveries')
      .upsert({ user_id: this.user.id, discovery }, { onConflict: 'user_id,discovery' })
      .select();
    return error ? null : data;
  },

  async getProgress() {
    if (!this.user) return null;
    const [vaults, cards, discoveries] = await Promise.all([
      _sb.from('vault_unlocks').select('vault_number, unlocked_at').eq('user_id', this.user.id),
      _sb.from('relic_cards').select('relic_number, claimed_at').eq('user_id', this.user.id),
      _sb.from('terminal_discoveries').select('discovery, discovered_at').eq('user_id', this.user.id),
    ]);
    return {
      clearance: this.profile?.clearance || 'OBSERVER',
      vaults: vaults.data || [],
      relicCards: cards.data || [],
      discoveries: discoveries.data || [],
    };
  }
};

// --- Auto-inject sign-in button + modal on every page ---
ObserverAuth._modalHTML = `
<div class="obs-modal-overlay" id="obsModal" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
  <div class="obs-modal" style="background:#0a0908;border:2px solid #c9a227;max-width:400px;width:90%;padding:36px 32px;text-align:center;box-shadow:0 0 40px rgba(201,162,39,.2)">
    <h2 style="font-family:'Cormorant Garamond',serif;font-size:26px;letter-spacing:2px;color:#c9a227;margin-bottom:12px">OBSERVER ACCESS</h2>
    <p style="font-size:11px;color:#a09a8c;line-height:1.9;margin-bottom:20px;font-family:'IBM Plex Mono',monospace">Enter your email. We\'ll send a secure sign-in link — no password needed.</p>
    <input type="email" id="obsEmail" placeholder="observer@archive.net" autocomplete="email" style="width:100%;background:#1a1510;border:1px solid #3d3226;color:#e8e0d0;font-family:'IBM Plex Mono',monospace;font-size:13px;padding:12px;margin-bottom:14px;outline:none">
    <button id="obsSendLink" style="width:100%;background:#c9a227;color:#000;border:none;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:3px;font-weight:600;padding:14px;cursor:pointer">SEND SIGN-IN LINK</button>
    <div class="msg" id="obsMsg" style="font-size:11px;margin-top:12px;min-height:18px;font-family:'IBM Plex Mono',monospace"></div>
    <span class="close-link" id="obsClose" style="display:block;margin-top:14px;font-size:10px;letter-spacing:2px;color:#a09a8c;cursor:pointer;font-family:'IBM Plex Mono',monospace">CANCEL</span>
  </div>
</div>`;

ObserverAuth._injectUI = function(){
  if(document.getElementById('obsModal')) return;
  const div = document.createElement('div');
  div.innerHTML = this._modalHTML;
  document.body.appendChild(div.firstElementChild);

  // Modal controls
  const overlay = document.getElementById('obsModal');
  const emailInput = document.getElementById('obsEmail');
  const sendBtn = document.getElementById('obsSendLink');
  const msg = document.getElementById('obsMsg');
  window.ObserverModal = {
    open(){ overlay.style.display='flex'; emailInput.focus(); },
    close(){ overlay.style.display='none'; msg.textContent=''; }
  };
  document.getElementById('obsClose').addEventListener('click', window.ObserverModal.close);
  overlay.addEventListener('click', e => { if(e.target === overlay) window.ObserverModal.close(); });
  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if(!email || !email.includes('@')){ msg.textContent='Enter a valid email.'; msg.style.color='#ff4444'; return; }
    sendBtn.disabled = true; sendBtn.textContent = 'SENDING...';
    const error = await ObserverAuth.signIn(email);
    sendBtn.disabled = false; sendBtn.textContent = 'SEND SIGN-IN LINK';
    if(error){ msg.textContent='Error: ' + error.message; msg.style.color='#ff4444'; }
    else { msg.textContent='Check your email for the sign-in link.'; msg.style.color='#33ff66'; }
  });
  emailInput.addEventListener('keydown', e => { if(e.key==='Enter') sendBtn.click(); });

  // Nav button — append to first <nav>, or header
  if(!document.querySelector('[data-obs-auth]')){
    const btn = document.createElement('a');
    btn.setAttribute('data-obs-auth','');
    btn.setAttribute('data-obs-label','SIGN IN');
    btn.href = '#';
    btn.style.cssText = 'border:1px solid #c9a227;color:#c9a227;font-size:10px;letter-spacing:2px;padding:8px 14px;cursor:pointer;text-decoration:none;white-space:nowrap';
    btn.addEventListener('click', e => { e.preventDefault(); });
    const nav = document.querySelector('nav');
    if(nav) nav.appendChild(btn);
    else { const h = document.querySelector('header'); if(h) h.appendChild(btn); }
  }
  this._refreshButtons();
};

ObserverAuth._displayName = function(){
  if(this.profile && this.profile.codename) return this.profile.codename;
  if(this.user && this.user.email) return this.user.email.split('@')[0].toUpperCase();
  return 'OBSERVER';
};

ObserverAuth._refreshButtons = function(){
  document.querySelectorAll('[data-obs-auth]').forEach(btn => {
    if(this.user){
      btn.textContent = '◈ ' + this._displayName();
      btn.style.borderColor = '#33ff66'; btn.style.color = '#33ff66';
      btn.onclick = async (e) => { e.preventDefault(); await this.signOut(); };
    } else {
      btn.textContent = btn.getAttribute('data-obs-label') || 'SIGN IN';
      btn.style.borderColor = '#c9a227'; btn.style.color = '#c9a227';
      btn.onclick = (e) => { e.preventDefault(); window.ObserverModal.open(); };
    }
  });
};

// Wrap init to inject UI
(function(){
  const _origInit = ObserverAuth.init.bind(ObserverAuth);
  ObserverAuth.init = async function(){
    const u = await _origInit();
    try { ObserverAuth._injectUI(); } catch(e){}
    return u;
  };
  document.addEventListener('observer-auth-change', ()=>{ try{ ObserverAuth._refreshButtons(); }catch(e){} });
})();
