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
    box.setAttribute('aria-label', `Mark ${item.title} as read`)
    box.addEventListener('change', () => { list = toggle(list, item.id); render() })
    const title = document.createElement('span')
    title.dataset.testid = 'item-title'
    title.textContent = item.title
    row.append(box, title)
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
