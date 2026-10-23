import express, { type Request, type Response, Router } from 'express';

const router: express.Router = Router();

router.get('/:id(\\d+)', (req: Request, res: Response) => {
  res.json({ id: req.params.id });
});

router.use('/files/*', (_req: Request, res: Response) => {
  res.sendStatus(200);
});
