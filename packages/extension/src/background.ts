chrome.runtime.onInstalled.addListener(() => {
  console.log('[background] Extension installed, registering context menu')
  chrome.contextMenus.create({
    id: 'correctr',
    title: 'Correct with Correctr',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('[background] Context menu clicked', { menuItemId: info.menuItemId, tabId: tab?.id, selectionText: info.selectionText })
  if (info.menuItemId !== 'correctr' || !tab?.id) {
    console.log('[background] Ignoring click — wrong item or no tab')
    return
  }
  console.log(`[background] Sending CORRECTR_TRIGGER to tab ${tab.id} with ${info.selectionText?.length ?? 0} chars`)
  chrome.tabs.sendMessage(tab.id, { type: 'CORRECTR_TRIGGER', text: info.selectionText ?? '' })
})
