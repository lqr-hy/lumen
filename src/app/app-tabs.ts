export interface AppTabRequest {
  path: string
  title: string
  initialPrompt?: string
}

export function openAppTab(request: AppTabRequest) {
  if (window.lumenElectron) {
    window.dispatchEvent(new CustomEvent<AppTabRequest>('app-tab-open', { detail: request }))
    return
  }

  window.open(request.path, '_blank', 'noopener,noreferrer')
}
