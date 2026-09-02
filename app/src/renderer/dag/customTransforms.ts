import { create } from 'zustand'
import { api } from '@/api/client'
import type { CustomTransform } from '@/wire/types'

/**
 * Studio's extra visual transforms (Flatten, To timestamp, Concatenate, Lookup…) are not API node
 * types: they are JSON+Python pairs in the account's Glue assets bucket that deploy as
 * `DynamicTransform`. We read the same files, so the palette shows what this account actually has.
 */
type Store = { list: CustomTransform[]; loaded: boolean; error?: string; bucket?: string; load: () => Promise<void> }
export const useCustomTransforms = create<Store>((set) => ({
  list: [], loaded: false,
  load: async () => {
    const r = await api.get<{ bucket: string; transforms: CustomTransform[] }>('/api/glue/transforms', 'the custom visual transforms')
    if (r.ok) set({ list: r.value.transforms, bucket: r.value.bucket, loaded: true, error: undefined })
    else set({ loaded: true, error: r.fault.why })
  },
}))

/** The node body Glue expects for one of them. */
export function dynamicTemplate(t: CustomTransform, name: string): Record<string, unknown> {
  return {
    Name: name, Inputs: [], TransformName: t.functionName || t.name, FunctionName: t.functionName || t.name,
    Path: t.path, Version: t.version ?? '1.0',
    Parameters: t.parameters.filter((p) => !p.isOptional).map((p) => ({ Name: p.name, Type: p.type === 'list' ? 'list' : 'str', Value: [] })),
  }
}
