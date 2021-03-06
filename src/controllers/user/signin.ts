import {User} from '../../models/user';
import {Request, Response} from 'express';
import bcrypt from 'bcryptjs';
import Joi from '@hapi/joi';
import APIResponse from '../../utils/APIResponse';

export async function signin(req: Request, res: Response): Promise<Response> {
  const {error} = validateSignin(req.body);

  if (error) {
    return APIResponse.UnprocessableEntity(res, error.message);
  }

  const user = await User.findOne({
    email: req.body.email,
  });

  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return APIResponse.Unauthorized(res, 'Invalid email or password!');
  }

  return APIResponse.Ok(res, {
    token: user.generateAuthToken(),
    user,
  });
}

// prettier-ignore
function validateSignin(user: {}): Joi.ValidationResult {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  })
  return schema.validate(user);
}
