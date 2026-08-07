export interface AppTabRequest {
  path: string
  title: string
}

export function openAppTab(request: AppTabRequest) {
  if (window.aiCampaignElectron) {
    window.dispatchEvent(new CustomEvent<AppTabRequest>('app-tab-open', { detail: request }))
    return
  }

  window.open(request.path, '_blank', 'noopener,noreferrer')
}
