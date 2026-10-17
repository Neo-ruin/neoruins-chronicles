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
    if (!error) this.profile = data;
    return this.profile;
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
