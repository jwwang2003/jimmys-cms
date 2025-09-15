# jimmys-cms

- NextJS Framework
    > This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
- Mantine UI
- Jtest
- Amazon AWS

## Getting Started

Set up your local AWS environment:
```bash
aws configure
```

### Development

```bash
# Dev server
pnpm dev

# Test
pnpm test
pnpm test:dev
pnpm test:prod
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Production

```bash
pnpm start

pnpm build
```

## Amazon AWS

- Ensure that AWS CLI is installed a login via SSO \(Access key & Secret access key\).
    - [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
    - [Logging in via the CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)