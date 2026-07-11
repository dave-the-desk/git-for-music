# UI Routing

This note maps the primary browser-facing routes to the code that owns them.

## Route Map

| Route | Entry file | Primary implementation |
|---|---|---|
| `/` | [src/app/page.tsx](../../src/app/page.tsx) | Redirects to `/groups` |
| `/home` | [src/app/home/page.tsx](../../src/app/home/page.tsx) | Home page shell |
| `/login` | [src/app/login/page.tsx](../../src/app/login/page.tsx) | [src/app/pages/auth/login-page.tsx](../../src/app/pages/auth/login-page.tsx) |
| `/signup` | [src/app/signup/page.tsx](../../src/app/signup/page.tsx) | [src/app/pages/auth/signup-page.tsx](../../src/app/pages/auth/signup-page.tsx) |
| `/account` | [src/app/account/page.tsx](../../src/app/account/page.tsx) | [src/app/pages/account/account-page.tsx](../../src/app/pages/account/account-page.tsx) |
| `/account/plugins` | [src/app/account/plugins/page.tsx](../../src/app/account/plugins/page.tsx) | [src/app/pages/account/plugins/account-plugins-page.tsx](../../src/app/pages/account/plugins/account-plugins-page.tsx) |
| `/groups` | [src/app/groups/page.tsx](../../src/app/groups/page.tsx) | [src/app/pages/groups/list/groups-page.tsx](../../src/app/pages/groups/list/groups-page.tsx) |
| `/groups/[groupId]` | [src/app/groups/[groupId]/page.tsx](../../src/app/groups/[groupId]/page.tsx) | [src/app/pages/groups/detail/group-page.tsx](../../src/app/pages/groups/detail/group-page.tsx) |
| `/groups/[groupId]/projects/[projectId]` | [src/app/groups/[groupId]/projects/[projectId]/page.tsx](../../src/app/groups/[groupId]/projects/[projectId]/page.tsx) | [src/app/pages/groups/project/project-page.tsx](../../src/app/pages/groups/project/project-page.tsx) |
| `/groups/[groupId]/projects/[projectId]/demos/[demoId]` | [src/app/groups/[groupId]/projects/[projectId]/demos/[demoId]/page.tsx](../../src/app/groups/[groupId]/projects/[projectId]/demos/[demoId]/page.tsx) | [src/app/pages/groups/demo/demo-page.tsx](../../src/app/pages/groups/demo/demo-page.tsx) |

## Route-Local UI Areas

- `src/app/pages/layouts/` for the app shell and root shell
- `src/app/pages/account/` for the account page and private plugin library
- `src/app/pages/groups/list/` for the group list page
- `src/app/pages/groups/detail/` for group detail pages
- `src/app/pages/groups/project/` for project detail pages
- `src/app/pages/groups/demo/components/daw/` for the DAW UI

## Realtime Refresh

- `src/app/pages/groups/lib/use-realtime-refresh.ts` listens for workspace refresh events.
- The app uses separate workspace refresh streams for list and shell data, distinct from DAW operation sync.

## Related Notes

- [[10_REPOS/web-app]]
- [[40_FEATURES/workspace-refresh]]
- [[30_UI/current-daw-ui-explanation]]
