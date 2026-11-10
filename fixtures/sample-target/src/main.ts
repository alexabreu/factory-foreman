import { add, empty, type Filter, summary, toggle, visible } from './reading-list'

let list = empty()
let filter: Filter = 'all'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `
  <h1>Reading list</h1>
  <form data-testid="add-form">
    <label for="new-title">Title</label>
    <input id="new-title" data-testid="new-title" autocomplete="off" />
    <button type="submit" data-testid="add">Add</button>
  </form>
  <label for="filter">Show</label>
  <select id="filter" data-testid="filter">
    <option value="all">All</option>
    <option value="unread">Unread</option>
    <option value="read">Read</option>
  </select>
  <p data-testid="summary" aria-live="polite"></p>
  <ul data-testid="items"></ul>
`

const input = app.querySelector<HTMLInputElement>('[data-testid="new-title"]')!
const items = app.querySelector<HTMLUListElement>('[data-testid="items"]')!
const status = app.querySelector<HTMLParagraphElement>('[data-testid="summary"]')!

function render() {
  items.replaceChildren(...visible(list, filter).map(item => {
    const row = document.createElement('li')
    row.dataset.testid = 'item'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = item.read
    box.dataset.testid = 'item-toggle'
    box.dataset.itemId = String(item.id)
    box.addEventListener('change', () => {
      list = toggle(list, item.id)
      render()
      // render() replaces every row, so put keyboard focus back on this item's
      // checkbox, or on the filter when the item is no longer shown.
      const again = items.querySelector<HTMLInputElement>(`[data-item-id="${item.id}"]`)
      ;(again ?? app.querySelector<HTMLSelectElement>('[data-testid="filter"]')!).focus()
    })
    const title = document.createElement('span')
    title.dataset.testid = 'item-title'
    title.textContent = item.title
    // The label names the checkbox after the book and makes the title clickable;
    // the checked state says whether it has been read.
    const label = document.createElement('label')
    label.append(box, title)
    row.append(label)
    return row
  }))
  status.textContent = summary(list)
}

app.querySelector('form')!.addEventListener('submit', event => {
  event.preventDefault()
  list = add(list, input.value)
  input.value = ''
  render()
})

app.querySelector<HTMLSelectElement>('[data-testid="filter"]')!.addEventListener('change', event => {
  filter = (event.target as HTMLSelectElement).value as Filter
  render()
})

render()
