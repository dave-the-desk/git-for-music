# Using the App

This is the shortest path through the app as it exists today.

## 1. Create an account

1. Go to `/signup` to create a new account.
1. If you already have an account, go to `/login` and sign in.
1. After sign-in, the app opens on your account area.

## 2. Open your account page

1. Use the `Account` button in the top-right header.
1. Your account page shows your name, email, and a link to the plugin library.
1. Use the `Plugin Library` button at the bottom of that page to open `/account/plugins`.

## 3. Upload a plugin

1. Open `/account/plugins`.
1. Upload a `.js` or `.mjs` WAM module by choosing a file or dragging it into the drop zone.
1. The plugin is added to your private library after upload completes.

## 4. Use the plugin in a demo

1. Open the demo you want to work with.
1. Grant the plugin to that demo from the demo-side plugin controls.
1. Once granted, the demo can load and use the plugin.

## 5. Update or remove a plugin

1. Return to `/account/plugins`.
1. Use the plugin library to review what you own.
1. From there, update or delete plugins as needed.

## 6. Try the fake test plugin

1. Upload [`docs/fake-wam-plugin.mjs`](./fake-wam-plugin.mjs) from this repo.
1. Grant it to a demo after it appears in your library.
1. The module is a small delay effect, so it is easy to hear in the DAW.

## Notes

- Private plugins stay in your account until you explicitly grant access to a demo.
- The current upload flow uses signed upload targets, then finishes the upload on the server.
- If a plugin does not load in a demo, check that the demo has been granted access to it.
