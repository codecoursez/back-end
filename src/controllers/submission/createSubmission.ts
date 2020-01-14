import { Submission, validateSubmission, SubmissionStatus } from '../../models/submission';
import { Request, Response } from 'express';
import axios from 'axios';
import { Problem, ProblemType } from '../../models/problem';
import APIResponse from '../../utils/APIResponse';
import { Contest } from '../../models/contest';
import { Standing } from '../../models/standing';

export async function create(req: Request, res: Response) {
  req.body.problem = req.params.problemID;
  const { error } = validateSubmission(req.body);
  if (error)
    return APIResponse.UnprocessableEntity(res, error.message)

  const problem = await Problem.findById(req.body.problem);
  if (!problem)
    return APIResponse.UnprocessableEntity(res, `No valid problem with id: ${req.body.problem}`);

  req.body.contest = await Contest.findById(req.params.contestID);
  if (!req.body.contest)
    return APIResponse.UnprocessableEntity(res, `No contest with id: ${req.params.contestID}`);
  // can submit?
  if (!contestStarted(req.body.contest))
    return APIResponse.Forbidden(res, 'You cannot submit to this contest! contest has not started yet!')
  // penality!

  if (problem.problemType == ProblemType[ProblemType.CODEFORCES])
    return judgeCodeforces(req, res, problem);
  // else
  //   return judgeLocally(req, res, problem);

}

export function contestStarted(contest: any) {
  const start = new Date(contest.startDate);
  return new Date() > start;
}

export function isDuringContest(contest: any) {
  const start = new Date(contest.startDate);
  const end = new Date();
  end.setMinutes(start.getMinutes() + contest.duration);
  console.log(`Start: ${start}\nDuration: ${contest.duration}\nEnd: ${end}\nNow: ${new Date()}`)
  return new Date() < end && new Date() > start;
}

async function createStandingForUser(contest: any, user: any) {
  const standing = new Standing({
    user,
    contest,
    penality: 0
  });

  for (const problem of contest.problems) {
    standing.problems.push({
      problem,
      isAccepted: false,
      failedSubmissions: 0,
      totalSubmissions: 0,
      isFirstAccepted: false,
    })
  }
  standing.save();
  return standing;
}

async function isFirstAccepted(submission: any) {
  // get first submission in the contest for this problem
  // bring the first accepted submission if any
  const firstAcceptedSubmission = await Submission.exists({
    contest: submission.contest,
    problem: submission.problem,
    verdict: "Accepted",
    createdAt: { $lt: submission.createdAt }
  })
  if (firstAcceptedSubmission) return false;
  return true; // no accepted submissions created before this one, so this is the first accepted submission
}

async function judgeCodeforces(req: any, res: Response, problem: any) {
  const submission = new Submission(req.body);

  submission.user = req.user._id;
  submission.submissionStatus = SubmissionStatus[SubmissionStatus.JUDGING];
  submission.isDuringContest = isDuringContest(req.body.contest);

  let standing: any;
  if (submission.isDuringContest) { // contest still running, create standing for this user
    standing = await Standing.findOne({
      contest: req.body.contest,
      user: submission.user,
    });
    if (!standing) standing = await createStandingForUser(submission.contest, submission.user);
  }
  console.log(`User standing: ${standing}`);

  try { // to submit to scrapper

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

    submission.verdict = scrapperResponse.data.submission.verdict.trim();
    submission.scrapperSubmissionID = scrapperResponse.data.submission.id;

    if (!isStillJudging(submission))
      submission.submissionStatus = SubmissionStatus[SubmissionStatus.DONE]

    await submission.save();

    APIResponse.Created(res, submission); // return response to user

    // keep making requests until judging is over

    const getLastVerdict = async () => {
      return new Promise(async function cb(resolve) {
        if (submission.submissionStatus == SubmissionStatus[SubmissionStatus.JUDGING]) {
          try { // to update submission verdict
            const scrapperResponse = await axios.get(
              `${process.env.CODEFORCES_SCRAPER_URL}/submission/${problem.codeforcesContestID}/${submission.scrapperSubmissionID}`,
              {
                headers: {
                  "x-api-key": process.env.CODEFORCES_SCRAPER_API_KEY
                }
              });
            submission.verdict = scrapperResponse.data.submission.verdict.trim();
            submission.time = scrapperResponse.data.submission.time;
            submission.memory = scrapperResponse.data.submission.memory;

            function calculateAcceptedPenality(contest: any) {
              return new Date().getMinutes() - new Date(contest.startDate).getMinutes();
            }

            if (isStillJudging(submission)) {
              setTimeout(() => cb(resolve), 3000); // keep trying to get verdict
            }
            else { // not judging, verdict is finally determined
              submission.submissionStatus = SubmissionStatus[SubmissionStatus.DONE];

              if (standing) // should update standing (submitted during contest)
                for (const index in standing.problems) {
                  // search for the problem in the standing problems array
                  if (standing.problems[index].problem.toString() == submission.problem.toString()) { // found the problem
                    standing.problems[index].totalSubmissions++; // increment submissions count for this problem
                    if (submission.verdict.toLowerCase() == "accepted") {
                      if (!standing.problems[index].isAccepted) {
                        console.log("---NEW AC---", problem.ballonColor);
                        // not accepted before
                        // should calculate penality, should increment solved
                        // should store solution time
                        const acPenality = calculateAcceptedPenality(submission.contest);
                        standing.solved++;
                        standing.problems[index].solvedAt = acPenality;
                        standing.penality += standing.problems[index].failedSubmissions * 20 + acPenality;
                      }
                      standing.problems[index].isAccepted = true;
                      if (await isFirstAccepted(submission)) {
                        console.log("---FIRST AC---", problem.ballonColor);
                        standing.problems[index].isFirstAccepted = true;
                      }
                    } else {
                      // wrong answer
                      standing.problems[index].failedSubmissions++; // increment failed submissions for this problem
                    }
                    standing.save();
                    break;
                  }

                }

              submission.save();
              resolve();
            }


          } catch (err) {
            console.log(err);
            console.log("Scrapper ERRRRRRRRRRRRRRORRRR!!!")
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

function isStillJudging(submission: any) {
  const verdict = submission.verdict.trim().toLowerCase();
  const stillJudging = verdict.startsWith("running") || verdict.startsWith("in");
  return stillJudging;
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
