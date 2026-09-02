import { api } from '@/api/client'
import { useApp } from '@/stores/app'

const REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1', 'eu-south-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'sa-east-1', 'me-south-1', 'af-south-1']

export function ProfilePicker() {
  const { state, refreshState, toggle } = useApp()
  const profiles = state?.profiles ?? []
  const set = async (profile?: string, region?: string) => {
    await api.post('/api/profile', { profile, region }, 'the profile change')
    await refreshState()
  }
  return (
    <>
      <select value={state?.profile ?? ''} onChange={(e) => { if (e.target.value === '__add') toggle('showSettings', true); else void set(e.target.value, undefined) }} title="AWS profile">
        <option value="" disabled>profile…</option>
        {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}{p.sso ? ' (sso)' : ''}</option>)}
        <option value="__add">Add SSO profile…</option>
      </select>
      <select value={state?.region ?? ''} onChange={(e) => void set(undefined, e.target.value)} title="Region">
        <option value="" disabled>region…</option>
        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </>
  )
}
