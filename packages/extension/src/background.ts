chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'correctr',
    title: 'Correct with Correctr',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'correctr' || !tab?.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'CORRECTR_TRIGGER' })
})
