# Jimmys-CMS

## Building & running

### From `create-project`

#### 📁 Project steps

1. `cd jimmys-cms`
2. `yarn run dev --open`

To close the dev server, hit `Ctrl-C`.

##### 🧩 Add-on steps

**drizzle:**
- You will need to set **DATABASE_URL** in your production environment
- Run yarn run `db:start` to start the docker container
- Run yarn run db:push to update your database schema
**lucia:**
- Run yarn run db:push to update your database schema
- Visit /demo/lucia route to view the demo
**paraglide**
- Edit your messages in messages/en.json
- Visit /demo/paraglide route to view the demo

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

### Developing

```sh
yarn dev

# or start the server and open the app in a new browser tab
yarn dev -- --open
```

### Building

```sh
yarn build
```

Preview the production build with `yarn preview`.

### Deploying

[adapter](https://svelte.dev/docs/kit/adapters)
