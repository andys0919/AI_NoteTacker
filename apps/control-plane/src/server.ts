import { createApp } from './app.js';
import { createRecordingJobRepositoryFromEnvironment } from './infrastructure/repository-factory.js';

const port = Number(process.env.PORT ?? '3000');

const main = async (): Promise<void> => {
  const repository = await createRecordingJobRepositoryFromEnvironment();
  const app = createApp(repository);

  app.listen(port, () => {
    console.log(`control-plane listening on http://localhost:${port}`);
  });
};

main().catch((error: unknown) => {
  console.error('failed to start control-plane', error);
  process.exit(1);
});
