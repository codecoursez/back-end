import express from 'express';
import * as problemController from '../controllers/problem';
import {authenticate} from '../middlewares/authentication';
import {authorize} from '../middlewares/authorization';
import {Roles} from '../models/user';

const router = express.Router();

router.use(authenticate);

router.get('/', problemController.getAll);
router.get('/:id', problemController.getWithId);

router.use(authorize([Roles.ADMIN]));

router.post('/', problemController.create);
router.put('/:id', problemController.updateWithId);
router.delete('/:id', problemController.deleteWithId);

export default router;
