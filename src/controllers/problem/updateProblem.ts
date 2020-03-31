import {Problem, validateProblem} from '../../models/problem';
import {Request, Response} from 'express';
import APIResponse from '../../utils/APIResponse';

export async function updateWithId(
  req: Request,
  res: Response,
): Promise<Response> {
  const problemId = req.params.id;

  const problem = await Problem.findById(problemId);

  if (!problem) {
    return APIResponse.NotFound(res, `No problem with id ${problemId}`);
  }

  const {error} = validateProblem(req.body);
  if (error) {
    return APIResponse.UnprocessableEntity(res, error.message);
  }

  await problem.set(req.body).save();
  return APIResponse.Ok(res, problem);
}
