import { Submission, validateSubmission, SubmissionStatus } from '../../models/submission';
import { Request, Response } from 'express';
import axios from 'axios';
import { Problem, ProblemType } from '../../models/problem';
import APIResponse from '../../utils/APIResponse';

export async function create(req: Request, res: Response) {
  const { error } = validateSubmission(req.body);
  if (error)
    return APIResponse.UnprocessableEntity(res, error.message)

  const problem = await Problem.findById(req.body.problem);
  if (!problem)
    return APIResponse.UnprocessableEntity(res, `No valid problem with id: ${req.body.problem}`);

  if (problem.problemType == ProblemType[ProblemType.CODEFORCES])
    return judgeCodeforces(req, res, problem);
  // else
  //   return judgeLocally(req, res, problem);

}


async function judgeCodeforces(req: any, res: Response, problem: any) {
  const submission = new Submission(req.body);
  submission.user = req.user._id;
  submission.submissionStatus = SubmissionStatus[SubmissionStatus.JUDGING];

  try {
    const scrapperResponse = await axios.post(`${process.env.CODEFORCES_SCRAPER_URL}/submit`, {
      "contestId": problem.codeforcesContestID,
      "problem": problem.codeforcesProblemLetter,
      "langId": submission.languageID,
      "sourceCode": submission.sourceCode
    }, {
      headers: {
        "x-api-key": process.env.CODEFORCES_SCRAPER_API_KEY
      }
    });
    submission.verdict = scrapperResponse.data.submission.verdict;
    submission.scrapperSubmissionID = scrapperResponse.data.submission.id;

    await submission.save();

    APIResponse.Created(res, submission); // return response to user

    // keep making requests until judging is over

    const getLastVerdict = async () => {
      return new Promise(async function cb(resolve) {
        if (submission.submissionStatus == SubmissionStatus[SubmissionStatus.JUDGING]) {
          try {
            const scrapperResponse = await axios.get(
              `${process.env.CODEFORCES_SCRAPER_URL}/submission/${problem.codeforcesContestID}/${submission.scrapperSubmissionID}`,
              {
                headers: {
                  "x-api-key": process.env.CODEFORCES_SCRAPER_API_KEY
                }
              });
            submission.verdict = scrapperResponse.data.submission.verdict;
            submission.executionTime = scrapperResponse.data.submission.time;
            submission.memory = scrapperResponse.data.submission.memory;

            const verdict = submission.verdict.toLowerCase();
            const stillJudging = verdict.startsWith("running") || verdict.startsWith("in");
            if (stillJudging) {
              setTimeout(() => cb(resolve), 3000);
            }
            else {
              submission.submissionStatus = SubmissionStatus[SubmissionStatus.DONE]
              resolve();
            }
            submission.save();

          } catch (err) {
            console.log(err);
            return APIResponse.BadRequest(res, err);
          }
        } else resolve();
      });

    }

    await getLastVerdict();



  } catch (err) {
    console.log(err)
    return APIResponse.BadRequest(res, "ERROR");
  }

}


// function judgeLocally(req: Request, res: Response, problem: any) {

//   const submission = new Submission(req.body);
//   submission.user = req.user._id;

//   let testCases: AxiosPromise[] = [];

//   problem.inputs.forEach((input: string, index: number) => {
//     const testCase = axios.post(
//       'https://api.judge0.com/submissions/?wait=true',
//       {
//         language_id: 15, // C++ latest version
//         source_code: req.body.sourceCode,
//         stdin: input,
//         expected_output: problem.outputs[index]
//       }
//     );
//     testCases.push(testCase);
//   });

//   Promise.all(testCases).then((res: AxiosResponse[]) => {
//     let verdict: Verdict = Verdict.ACCEPTED;
//     res.forEach(response => {
//       // id	3
//       // description	"Accepted"
//       // id	4
//       // description	"Wrong Answer"
//       // id	5
//       // description	"Time Limit Exceeded"
//       // id	6
//       // description	"Compilation Error"
//       // id	7
//       // description	"Runtime Error (SIGSEGV)"
//       // id	13
//       // description	"Internal Error"

//       // TODO: Better implementation!!!!

//       // if any testcase not accepted stop
//       if (response.data.status.id != 3) {
//         verdict = response.data.status.id;
//         return;
//       }
//     });
//     submission.verdict = Verdict[verdict];
//     submission.save();
//   });
//   submission.save();
//   res.send(submission);
// }
