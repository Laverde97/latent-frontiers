/* =========================================================================
   backend.js — the only place that talks to Supabase tables / functions.
   It never sends a user id: the server derives it from the signed session
   (auth.uid()) and Row Level Security enforces ownership.
   ========================================================================= */

function wrap(error) {
  const e = new Error(error.message || 'backend error');
  e.code = error.code;
  e.offline = /fetch|network|Failed to fetch|NetworkError/i.test(error.message || '');
  return e;
}

export function createBackend(client) {
  return {
    async load() {
      const { data, error } = await client.from('efl_learner_state').select('state,rev').maybeSingle();
      if (error) { throw wrap(error); }
      return data ? { state: data.state, rev: Number(data.rev) } : null;
    },
    async save(state, expectedRev, device = null) {
      const { data, error } = await client.rpc('efl_save_state', {
        p_state: state, p_state_version: state.version, p_expected_rev: expectedRev, p_device: device
      });
      if (error) { throw wrap(error); }
      return { status: data.status, rev: data.rev == null ? null : Number(data.rev) };
    },
    async hasAdultConfirmation() {
      const { data, error } = await client.from('efl_profiles').select('created_at').maybeSingle();
      if (error) { throw wrap(error); }
      return !!data;
    },
    async confirmAdult(termsVersion) {
      const { error } = await client.from('efl_profiles').insert({ adult_confirmed: true, terms_version: termsVersion });
      if (error && error.code !== '23505') { throw wrap(error); }
    },
    async deleteAccount() {
      const { error } = await client.rpc('efl_delete_my_account');
      if (error) { throw wrap(error); }
    }
  };
}
