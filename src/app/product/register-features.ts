import { registerFeature } from '@git-for-music/shared';

registerFeature({
  id: 'plugins',
  description: 'Browser plugin library and upload flow.',
  enabledByDefault: true,
  envVar: 'FEATURE_PLUGINS',
});
