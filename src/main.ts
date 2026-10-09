import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = configureApp(app);
  await app.listen(config.PORT, '0.0.0.0');
}
void bootstrap();
