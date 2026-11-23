import { buildApp } from './app.ts'

const bootstrap = async () => {
  const app = await buildApp()
  const port = Number(process.env.PORT) || 3000

  // Type assertion since buildApp stub returns partial Fastify instance
  const fastifyApp = app as any

  await new Promise<void>((resolve, reject) => {
    fastifyApp.listen({ port }, (err: unknown) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })

  console.log(`Server listening on port ${port}`)
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err)
  process.exit(1)
})