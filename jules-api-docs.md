# Jules API

## Introduction


The Jules API lets you programmatically access Jules's capabilities to automate and enhance your software development lifecycle.
You can use the API to create custom workflows, automate tasks like bug fixing and code reviews, and embed Jules's intelligence directly into the tools you use every day, such as Slack, Linear, and GitHub.

> [!NOTE]
>
> **Note:** The Jules API is in an alpha release, which means it is experimental.
> Be aware that we may change specifications, API keys, and definitions as we work toward stabilization.
> In the future, we plan to maintain at least one stable and one experimental version.

## Authentication

To get started with the Jules API, you'll need an API key.

### Generate Your API Key

In the Jules web app, go to the **[Settings](https://jules.google.com/settings#api)** page to create a new API key. You can have at most 3 API keys at a time.
![Jules API Key creation interface](https://developers.google.com/static/jules/assets/jules-api-key-settings.png)

### Use Your API Key

To authenticate your requests, pass the API key in the `X-Goog-Api-Key` header of your API calls.

> [!WARNING]
> **Important:** Keep your API keys secure. Don't share them or embed them in public code. For your protection, any API keys found to be publicly exposed will be [automatically disabled](https://cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts#disable-exposed-keys) to prevent abuse.

## API concepts

The Jules API is built around a few core resources. Understanding these will help you use the API effectively.

**Source**
:   An input source for the agent (e.g., a GitHub repository). Before using a source using the API, you must first [install the Jules GitHub app](https://jules.google/docs) through the Jules web app.

**Session**
:   A continuous unit of work within a specific context, similar to a chat session. A session is initiated with a prompt and a source.

**Activity**
:   A single unit of work within a Session. A Session contains multiple activities from both the user and the agent, such as generating a plan, sending a message, or updating progress.

## Quickstart: Your first API call

We'll walk through creating your first session with the Jules API using curl.

### Step 1: List your available sources

First, you need to find the name of the source you want to work with (e.g., your GitHub repo). This command will return a list of all sources you have connected to Jules.

    curl 'https://jules.googleapis.com/v1alpha/sources' \
        -H 'X-Goog-Api-Key: YOUR_API_KEY'

The response will look something like this:

    {
      "sources": [
        {
          "name": "sources/github/bobalover/boba",
          "id": "github/bobalover/boba",
          "githubRepo": {
            "owner": "bobalover",
            "repo": "boba"
          }
        }
      ],
      "nextPageToken": "github/bobalover/boba-web"
    }

### Step 2: Create a new session

Now, create a new session. You'll need the source name from the previous step. This request tells Jules to create a boba app in the specified repository.

    curl 'https://jules.googleapis.com/v1alpha/sessions' \
        -X POST \
        -H "Content-Type: application/json" \
        -H 'X-Goog-Api-Key: YOUR_API_KEY' \
        -d '{
          "prompt": "Create a boba app!",
          "sourceContext": {
            "source": "sources/github/bobalover/boba",
            "githubRepoContext": {
              "startingBranch": "main"
            }
          },
          "automationMode": "AUTO_CREATE_PR",
          "title": "Boba App"
        }'

The `automationMode` field is optional. By default, no PR will be automatically created.

The immediate response will look something like this:

    {
            "name": "sessions/31415926535897932384",
            "id": "31415926535897932384",
            "title": "Boba App",
            "sourceContext": {
              "source": "sources/github/bobalover/boba",
              "githubRepoContext": {
                "startingBranch": "main"
              }
            },
            "prompt": "Create a boba app!"
          }

You can poll the latest session information using GetSession or ListSessions. For example, if a PR was automatically created, you can see the PR in the session output.

    {
      "name": "sessions/31415926535897932384",
      "id": "31415926535897932384",
      "title": "Boba App",
      "sourceContext": {
        "source": "sources/github/bobalover/boba",
        "githubRepoContext": {
          "startingBranch": "main"
        }
      },
      "prompt": "Create a boba app!",
      "outputs": [
        {
          "pullRequest": {
            "url": "https://github.com/bobalover/boba/pull/35",
            "title": "Create a boba app",
            "description": "This change adds the initial implementation of a boba app."
          }
        }
      ]
    }
        
By default, sessions created through the API will have their plans automatically approved. If you want to create a session that requires explicit plan approval, set the `requirePlanApproval` field to `true`.

### Step 3: Listing sessions

You can list your sessions as follows.

    curl 'https://jules.googleapis.com/v1alpha/sessions?pageSize=5' \
        -H 'X-Goog-Api-Key: YOUR_API_KEY'

### Step 4: Approve plan

If your session requires explicit plan approval, you can approve the latest plan as follows:

    curl 'https://jules.googleapis.com/v1alpha/sessions/SESSION_ID:approvePlan' \
        -X POST \
        -H "Content-Type: application/json" \
        -H 'X-Goog-Api-Key: YOUR_API_KEY'

### Step 5: Activities and interacting with the agent

To list activities in a session:

    curl 'https://jules.googleapis.com/v1alpha/sessions/SESSION_ID/activities?pageSize=30' \
        -H 'X-Goog-Api-Key: YOUR_API_KEY'

To send a message to the agent:

    curl 'https://jules.googleapis.com/v1alpha/sessions/SESSION_ID:sendMessage' \
        -X POST \
        -H "Content-Type: application/json" \
        -H 'X-Goog-Api-Key: YOUR_API_KEY' \
        -d '{
          "prompt": "Can you make the app corgi themed?"
        }'

The response will be empty because the agent will send its response in the next activity. To see the agent's response, list the activities again.

Here is an example of a ListActivities response.

    {
      "activities": [
        {
          "name": "sessions/14550388554331055113/activities/02200cce44f746308651037e4a18caed",
          "createTime": "2025-10-03T05:43:42.801654Z",
          "originator": "agent",
          "planGenerated": {
            "plan": {
              "id": "5103d604240042cd9f59a4cb2355643a",
              "steps": [
                {
                  "id": "705a61fc8ec24a98abc9296a3956fb6b",
                  "title": "Setup the environment. I will install the dependencies to run the app."
                },
                {
                  "id": "bb5276efad354794a4527e9ad7c0cd42",
                  "title": "Modify `src/App.js`. I will replace the existing React boilerplate with a simple Boba-themed component. This will include a title and a list of boba options.",
                  "index": 1
                },
                {
                  "id": "377c9a1c91764dc794a618a06772e3d8",
                  "title": "Modify `src/App.css`. I will update the CSS to provide a fresh, modern look for the Boba app.",
                  "index": 2
                },
                {
                  "id": "335802b585b449aeabb855c722cd9c40",
                  "title": "Frontend Verification. I will use the `frontend_verification_instructions` tool to get instructions on how to write a Playwright script to verify the frontend application and generate a screenshot of the changes.",
                  "index": 3
                },
                {
                  "id": "3e4cc97c7b2448668d1ac75b8c7b7d69",
                  "title": "Submit the changes. Once the app is looking good and verified, I will submit my work.",
                  "index": 4
                }
              ]
            }
          },
          "id": "02200cce44f746308651037e4a18caed"
        },
        {
          "name": "sessions/14550388554331055113/activities/2918fac8bc54450a9cbda423b7688413",
          "createTime": "2025-10-03T05:43:44.954030Z",
          "originator": "user",
          "planApproved": {
            "planId": "5103d604240042cd9f59a4cb2355643a"
          },
          "id": "2918fac8bc54450a9cbda423b7688413"
        },
        {
          "name": "sessions/14550388554331055113/activities/5b3acd1b3ca2439f9cbaefaccf7f709a",
          "createTime": "2025-10-03T05:44:16.700231Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "Ran bash command",
            "description": "Command: \nnpm install\nOutput: added 1326 packages, and audited 1327 packages in 25s\n\n268 packages are looking for fundingExit Code: 0"
          },
          "artifacts": [
            {
              "bashOutput": {
                "command": "\nnpm install",
                "output": "added 1326 packages, and audited 1327 packages in 25s\n\n268 packages are looking for funding"
              }
            }
          ],
          "id": "5b3acd1b3ca2439f9cbaefaccf7f709a"
        },
        {
          "name": "sessions/14550388554331055113/activities/1ad545d812614a5b84c23a33f6120063",
          "createTime": "2025-10-03T05:44:19.502115Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "I have installed the dependencies using `npm install`."
          },
          "artifacts": [
            {
              "changeSet": {
                "source": "sources/github/bobalover/boba",
                "gitPatch": {
                  "baseCommitId": "36ead0a4caefc451b9652ed926a15af9570f4f35"
                }
              }
            }
          ],
          "id": "1ad545d812614a5b84c23a33f6120063"
        },
        {
          "name": "sessions/14550388554331055113/activities/3a2b46329f894ebea1faf6b8fb956428",
          "createTime": "2025-10-03T05:44:29.265425Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "I have replaced the boilerplate in `src/App.js` with a Boba-themed component."
          },
          "artifacts": [
            {
              "changeSet": {
                "source": "sources/github/bobalover/boba",
                "gitPatch": {
                  "unidiffPatch": "",
                  "baseCommitId": "36ead0a4caefc451b9652ed926a15af9570f4f35"
                }
              }
            }
          ],
          "id": "3a2b46329f894ebea1faf6b8fb956428"
        },
        {
          "name": "sessions/14550388554331055113/activities/4e8dd66f15e247e3ae5e48eeff89ef47",
          "createTime": "2025-10-03T05:44:37.721013Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "I have updated the CSS in `src/App.css` to give the app a fresh, modern look."
          },
          "artifacts": [
            {
              "changeSet": {
                "source": "sources/github/bobalover/boba",
                "gitPatch": {
                  "unidiffPatch": ""
                }
              }
            }
          ],
          "id": "4e8dd66f15e247e3ae5e48eeff89ef47"
        },
        {
          "name": "sessions/14550388554331055113/activities/100901155a4141d3b37e8e8d2950f3b7",
          "createTime": "2025-10-03T05:44:51.048996Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "Ran bash command",
            "description": "Command: \nOutput: Command failed due to an internal error.\nExit Code: 1"
          },
          "artifacts": [
            {
              "bashOutput": {
                "output": "Command failed due to an internal error.",
                "exitCode": 1
              }
            }
          ],
          "id": "100901155a4141d3b37e8e8d2950f3b7"
        },
        {
          "name": "sessions/14550388554331055113/activities/a76b35353eda42d09b1c37aedaa56047",
          "createTime": "2025-10-03T05:47:49.628363Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "Frontend verification",
            "description": "Agent provided UI verification."
          },
          "artifacts": [
            {
              "media": {
                "data": "",
                "mimeType": "image/png"
              }
            }
          ],
          "id": "a76b35353eda42d09b1c37aedaa56047"
        },
        {
          "name": "sessions/14550388554331055113/activities/db089c7052024cbeb9e37b8c584bc964",
          "createTime": "2025-10-03T05:47:53.669642Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "I have successfully verified the frontend changes by building the app, runnin...",
            "description": "I have successfully verified the frontend changes by building the app, running a Playwright script, and inspecting the resulting screenshot."
          },
          "artifacts": [
            {
              "changeSet": {
                "source": "sources/github/bobalover/boba",
                "gitPatch": {
                  "unidiffPatch": "",
                  "baseCommitId": "36ead0a4caefc451b9652ed926a15af9570f4f35"
                }
              }
            }
          ],
          "id": "db089c7052024cbeb9e37b8c584bc964"
        },
        {
          "name": "sessions/14550388554331055113/activities/890e16e30dbb4bf99a92613bdccec212",
          "createTime": "2025-10-03T05:48:14.434427Z",
          "originator": "agent",
          "progressUpdated": {
            "title": "Code reviewed",
            "description": "The user wants to create a \"boba app\". This is a very open-ended request, but the agent's implementation suggests the goal is to create a simple, static web page about boba."
          },
          "id": "890e16e30dbb4bf99a92613bdccec212"
        },
        {
          "name": "sessions/14550388554331055113/activities/022837dbc0e940eabcc1bc53608e15fc",
          "createTime": "2025-10-03T05:48:35.523200Z",
          "originator": "agent",
          "sessionCompleted": {},
          "artifacts": [
            {
              "changeSet": {
                "source": "sources/github/bobalover/boba",
                "gitPatch": {
                  "unidiffPatch": "",
                  "baseCommitId": "36ead0a4caefc451b9652ed926a15af9570f4f35",
                  "suggestedCommitMessage": "feat: Create simple Boba App\n\nThis commit transforms the default Create React App boilerplate into a simple, visually appealing Boba-themed application."
                }
              }
            }
          ],
          "id": "022837dbc0e940eabcc1bc53608e15fc"
        }
      ]
    }

## Full API reference

View the full [API reference](https://developers.google.com/jules/api/reference/rest) documentation for the Jules API.

*** ** * ** ***