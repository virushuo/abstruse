import { Repository, Build } from './model';
import { getHttpJsonResponse, getBitBucketAccessToken } from '../utils';
import { addRepositoryPermissionToEveryone } from './permission';
import { URL } from 'url';

export function getRepository(id: number, userId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository({ id: id })
      .fetch({ withRelated: ['access_token', 'variables', 'permissions'] })
      .then(repo => {
        if (!repo) {
          reject(repo);
        }

        repo = repo.toJSON();
        let userid = Number(userId);
        if (repo.permissions && repo.permissions.length) {
          let index = repo.permissions.findIndex(p => p.users_id === userid);
          if (index !== -1 && repo.permissions[index].permission) {
            repo.hasPermission = true;
          } else {
            repo.hasPermission = false;
          }
        } else {
          repo.hasPermission = false;
        }

        resolve(repo);
      })
      .catch(err => reject(err));
  });
}

export function getRepositoryBuilds(
  id: number,
  limit: number,
  offset: number,
  userid: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    new Build().query(qb => {
      qb.where('repositories_id', id);
      qb.orderBy('id', 'desc');
      qb.limit(limit);
      qb.offset(offset);
    })
      .fetchAll({ withRelated: ['jobs.runs', 'repository.permissions'] })
      .then(builds => {
        if (!builds) {
          reject();
        }

        builds = builds.toJSON();
        builds = builds.map(build => {
          build.jobs = build.jobs.map(job => {
            if (job.runs.length > 0) {
              job.end_time = job.runs[job.runs.length - 1].end_time;
              job.start_time = job.runs[job.runs.length - 1].start_time;
              job.status = job.runs[job.runs.length - 1].status;
            }

            delete job.runs;
            return job;
          });

          userid = Number(userid);
          if (build.repository.permissions && build.repository.permissions.length) {
            let index = build.repository.permissions.findIndex(p => p.users_id === userid);
            if (index !== -1 && build.repository.permissions[index].permission) {
              build.hasPermission = true;
            } else {
              build.hasPermission = false;
            }
          } else {
            build.hasPermission = false;
          }

          return build;
        });

        resolve(builds);
      }).catch(err => reject(err));
  });
}

export function getRepositoryOnly(id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository({ id: id }).fetch({ withRelated: ['access_token'] }).then(repo => {
      if (!repo) {
        reject(repo);
      } else {
        repo = repo.toJSON();
        if (typeof repo.access_token !== 'undefined') {
          const token_data = repo.access_token;
          if (token_data.type === 'bitbucket') {
            const credentials = `${token_data.bitbucket_oauth_key}:${token_data.bitbucket_oauth_secret}`;
            getBitBucketAccessToken(credentials)
              .then(resp => {
                repo.access_token = `${token_data.bitbucket_client_id}:${resp.access_token}`;
                resolve(repo);
              })
              .catch(err => reject(err));
          } else if (token_data.type === 'gitlab') {
            repo.access_token = repo.access_token && repo.access_token.token ?
              `${repo.access_token.gitlab_username}:${repo.access_token.token}` : null;
            resolve(repo);
          } else {
            repo.access_token = repo.access_token && repo.access_token.token ? repo.access_token.token : null;
            resolve(repo);
          }
        } else {
          repo.access_token = null;
          resolve(repo);
        }
      }
    }).catch(err => reject(err));
  });
}

export function getRepositoryBadge(id: number): Promise<string> {
  return new Promise((resolve, reject) => {
    new Repository({ id: id })
      .fetch({
        withRelated: [
          { 'builds': query => query.where('pr', null).orderBy('id', 'desc').limit(1) },
          { 'builds.runs': query => query.orderBy('id', 'desc').limit(1) },
          { 'builds.runs.job_runs': query => query.groupBy('job_id', 'max(id)') }
        ]
      } as any)
      .then(repo => {
        if (!repo) {
          resolve('unknown');
        } else {
          repo = repo.toJSON();
          let status = 'unknown';

          if (repo.builds[0] && repo.builds[0].runs[0]) {
            if (repo.builds[0].runs[0].job_runs.findIndex(run => run.status === 'queued') !== -1) {
              status = 'queued';
            }

            if (repo.builds[0].runs[0].job_runs.findIndex(run => run.status === 'failed') !== -1) {
              status = 'failing';
            }

            if (repo.builds[0].runs[0].job_runs.findIndex(run => run.status === 'running') !== -1) {
              status = 'running';
            }

            if (repo.builds[0].runs[0].job_runs.length ===
              repo.builds[0].runs[0].job_runs.filter(run => run.status === 'success').length) {
              status = 'passing';
            }
          }

          resolve(status);
        }
      });
  });
}

export function getRepositoryByBuildId(buildId: number): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository().query(qb => {
      qb.leftJoin('builds', 'repositories.id', 'builds.repositories_id');
      qb.where('builds.id', '=', buildId);
    }).fetch({ withRelated: ['access_token', 'variables'] }).then(repo => {
      if (!repo) {
        reject();
      } else {
        resolve(repo.toJSON());
      }
    });
  });
}

export function getRepositories(keyword: string, userId?: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    new Repository().query(q => {
      if (keyword !== '') {
        q.where('full_name', 'like', `%${keyword}%`).orWhere('clone_url', 'like', `%${keyword}%`);
      }

      if (userId) {
        q.innerJoin('permissions', 'permissions.repositories_id', 'repositories.id')
          .where('permissions.users_id', userId)
          .andWhere(function () {
            this.where('permissions.permission', true).orWhere('public', true);
          });
      } else {
        q.where('repositories.public', true);
      }
    }).fetchAll({
      withRelated: [{
        'permissions': (query) => {
          if (userId) {
            query.where('permissions.users_id', userId);
          } else {
            return false;
          }
        }
      }]
    })
      .then(repos => {
        if (!repos) {
          reject();
        }
        repos = repos.toJSON();

        resolve(repos);
      });
  });
}

export function getRepositoryId(owner: string, repository: string): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository().query(q => q.where('full_name', `${owner}/${repository}`)).fetch()
      .then(repo => !repo ? reject() : resolve(repo.toJSON().id));
  });
}

export function addRepository(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository().save(data, { method: 'insert' })
      .then(result => {
        if (!result) {
          reject(result);
        } else {
          let repository = result.toJSON();
          return addRepositoryPermissionToEveryone(repository.id)
            .then(() => resolve(repository))
            .catch(err => reject(err));
        }
      })
      .catch(err => reject(err));
  });
}

export function saveRepositorySettings(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository({ id: data.id }).save(data, { method: 'update', require: false })
      .then(repo => !repo ? reject(repo) : resolve(repo.toJSON()));
  });
}

export function updateRepositoryPermission(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    new Repository({ id: data.id }).save(data, { method: 'update', require: false })
      .then(repo => !repo ? reject(repo) : resolve(repo.toJSON()));
  });
}

export function updateRepository(data: any): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let repository: Repository;
    if (data.github_id) {
      repository = new Repository().where({ github_id: data.github_id });
    } else if (data.bitbucket_id) {
      repository = new Repository().where({ bitbucket_id: data.bitbucket_id });
    } else if (data.gitlab_id) {
      repository = new Repository().where({ gitlab_id: data.gitlab_id });
    } else if (data.gogs_id) {
      repository = new Repository().where({ gogs_id: data.gogs_id });
    } else {
      reject('Repository Id missing');
    }

    repository.save(data, { method: 'update', require: false }).then(result => {
      if (!result) {
        reject(result);
      } else {
        resolve(result.toJSON());
      }
    }).catch(err => reject(err));
  });
}

export function pingGitHubRepository(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let saveData = generateGitHubRepositoryData(data);
    new Repository().where({ github_id: saveData.github_id }).fetch()
      .then(repo => {
        if (!repo) {
          new Repository().save(saveData, { method: 'insert' })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                let repository = result.toJSON();
                return addRepositoryPermissionToEveryone(result.id)
                  .then(() => resolve(repository))
                  .catch(err => reject(err));
              }
            })
            .catch(err => reject(err));
        } else {
          repo.save(saveData, { method: 'update', require: false })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                resolve(result.toJSON());
              }
            })
            .catch(err => reject(err));
        }
      });
  });
}

export function pingBitbucketRepository(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let saveData = generateBitbucketRepositoryData(data);
    new Repository().where({ bitbucket_id: saveData.bitbucket_id }).fetch()
      .then(repo => {
        if (!repo) {
          new Repository().save(saveData, { method: 'insert' })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                let repository = result.toJSON();
                return addRepositoryPermissionToEveryone(result.id)
                  .then(() => resolve(repository))
                  .catch(err => reject(err));
              }
            }).catch(err => reject(err));
        } else {
          repo.save(saveData, { method: 'update', require: false })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                resolve(result.toJSON());
              }
            })
            .catch(err => reject(err));
        }
      });
  });
}

export function pingGitLabRepository(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let saveData = generateGitLabRepositoryData(data);
    new Repository().where({ gitlab_id: saveData.gitlab_id }).fetch()
      .then(repo => {
        if (!repo) {
          new Repository().save(saveData, { method: 'insert' })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                let repository = result.toJSON();

                return addRepositoryPermissionToEveryone(repository.id)
                  .then(() => resolve(repository))
                  .catch(err => reject(err));
              }
            })
            .catch(err => reject(err));
        } else {
          repo.save(saveData, { method: 'update', require: false })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                resolve(result.toJSON());
              }
            })
            .catch(err => reject(err));
        }
      });
  });
}

export function pingGogsRepository(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let saveData = generateGogsRepositoryData(data);
    new Repository().where({ gogs_id: saveData.gogs_id }).fetch()
      .then(repo => {
        if (!repo) {
          new Repository().save(saveData, { method: 'insert' })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                let repository = result.toJSON();

                return addRepositoryPermissionToEveryone(repository.id)
                  .then(() => resolve(repository))
                  .catch(err => reject(err));
              }
            })
            .catch(err => reject(err));
        } else {
          repo.save(saveData, { method: 'update', require: false })
            .then(result => {
              if (!result) {
                reject(result);
              } else {
                resolve(result.toJSON());
              }
            })
            .catch(err => reject(err));
        }
      });
  });
}

export function createGitHubPullRequest(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let ghid = data.base ? data.base.repo.id : data.pull_request.base.repo.id;
    new Repository().where({ github_id: ghid }).fetch()
      .then(repo => {
        if (!repo) {
          return Promise.resolve(repo);
        } else {
          return Promise.resolve(repo.toJSON());
        }
      })
      .then(repoData => {
        if (!repoData) {
          let rdata = generateGitHubRepositoryData(data);
          return addRepository(rdata);
        } else {
          return Promise.resolve(repoData);
        }
      })
      .then(repo => {
        let buildData = {
          pr: data.number,
          data: data,
          start_time: new Date(),
          repositories_id: repo.id
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

export function createGogsPullRequest(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let repoId = data.repository.id;
    new Repository().where({ gogs_id: repoId }).fetch()
      .then(repo => {
        if (!repo) {
          let repoData = generateGogsRepositoryData(data);
          return addRepository(repoData);
        } else {
          return Promise.resolve(repo.toJSON());
        }
      })
      .then(repo => {
        let buildData = {
          pr: data.number,
          data: data,
          start_time: new Date(),
          repositories_id: repo.id
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

export function synchronizeGitHubPullRequest(data: any): Promise<any> {
  let repoId;
  return new Promise((resolve, reject) => {
    let ghid = data.base ? data.base.repo.id : data.pull_request.base.repo.id;
    new Repository().where({ github_id: ghid }).fetch()
      .then(repository => {
        if (!repository) {
          let repoData = generateGitHubRepositoryData(data);
          return addRepository(repoData).then(repo => {
            repoId = repo.id;
          });
        } else {
          let repoJson = repository.toJSON();
          repoId = repoJson.id;
          return Promise.resolve();
        }
      })
      .then(() => {
        let repoData = generateGitHubRepositoryData(data);
        return updateRepository(repoData);
      })
      .then(() => {
        let buildData = {
          pr: data.pull_request.number,
          data: data,
          start_time: new Date(),
          repositories_id: repoId
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

export function synchronizeBitbucketPullRequest(data: any): Promise<any> {
  let repoId;
  return new Promise((resolve, reject) => {
    new Repository().where({ bitbucket_id: data.repository.uuid }).fetch()
      .then(repository => {
        if (!repository) {
          let repoData = generateBitbucketRepositoryData(data);
          return addRepository(repoData).then(repo => repoId = repo.id);
        } else {
          let repoJson = repository.toJSON();
          repoId = repoJson.id;
          let repoData = generateBitbucketRepositoryData(data);
          return updateRepository(repoData);
        }
      })
      .then(() => {
        let buildData = {
          pr: data.pull_request ? data.pull_request.id : null,
          data: data,
          start_time: new Date(),
          repositories_id: repoId
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

export function synchronizeGogsPullRequest(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let repoId = data.repository.id;
    new Repository().where({ gogs_id: repoId }).fetch()
      .then(repository => {
        if (!repository) {
          let repoData = generateGogsRepositoryData(data);
          return addRepository(repoData).then(repo => {
            repoId = repo.id;
          });
        } else {
          let repoJson = repository.toJSON();
          repoId = repoJson.id;
          let repoData = generateGogsRepositoryData(data);

          return updateRepository(repoData);
        }
      })
      .then(() => {
        let buildData = {
          pr: data.pull_request ? data.pull_request.id : null,
          data: data,
          start_time: new Date(),
          repositories_id: repoId
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

export function synchronizeGitLabPullRequest(data: any): Promise<any> {
  let repoId;
  return new Promise((resolve, reject) => {
    let gitlabId = data.project_id ? data.project_id : data.object_attributes.target_project_id;
    new Repository().where({ gitlab_id: gitlabId }).fetch()
      .then(repository => {
        if (!repository) {
          let repoData = generateGitLabRepositoryData(data);
          return addRepository(repoData).then(repo => {
            repoId = repo.id;
          });
        } else {
          let repoJson = repository.toJSON();
          repoId = repoJson.id;
          let repoData = generateGitLabRepositoryData(data);
          return updateRepository(repoData);
        }
      })
      .then(() => {
        let buildData = {
          pr: data.object_attributes.iid,
          data: data,
          start_time: new Date(),
          repositories_id: repoId
        };

        resolve(buildData);
      })
      .catch(err => reject(err));
  });
}

function generateGitHubRepositoryData(data: any): any {
  let url = new URL(data.repository.clone_url);
  let apiUrl = url.protocol + '//api.' + url.host;

  return {
    github_id: data.repository.id,
    clone_url: data.repository.clone_url,
    html_url: data.repository.html_url,
    default_branch: data.repository.default_branch,
    name: data.repository.name,
    full_name: data.repository.full_name,
    description: data.repository.description,
    private: data.repository.private,
    fork: data.repository.fork,
    user_login: data.repository.owner.login,
    user_id: data.repository.owner.id,
    user_avatar_url: data.repository.owner.avatar_url,
    user_url: data.repository.owner.url,
    user_html_url: data.repository.owner.html_url,
    repository_provider: 'github',
    api_url: apiUrl,
    data: data
  };
}

function generateBitbucketRepositoryData(data: any): any {
  let url = new URL(data.repository.links.self.href);
  let apiUrl = url.protocol + '//' + url.host + '/2.0/repositories';

  return {
    bitbucket_id: data.repository.uuid,
    clone_url: `${data.repository.links.html.href}.git`,
    html_url: data.repository.links.html.href,
    default_branch: data.changes && data.changes[0].new.name ? data.changes[0].new.name
      : data.pullrequest ? data.pullrequest.destination.branch.name : '',
    name: data.repository.name,
    full_name: data.repository.full_name,
    private: data.repository.is_private,
    user_login: data.actor.username,
    user_id: data.actor.uuid,
    user_avatar_url: data.actor.links.avatar.href,
    user_url: data.actor.links.self.href,
    user_html_url: data.actor.links.html.href,
    repository_provider: 'bitbucket',
    api_url: apiUrl,
    data: data
  };
}

function generateGitLabRepositoryData(data: any): any {
  let url = new URL(data.repository.git_http_url || data.project.git_http_url);
  let apiUrl = url.protocol + '//' + url.host + '/api/v4';

  return {
    gitlab_id: data.project_id ? data.project_id : data.object_attributes.target_project_id,
    clone_url: data.repository.git_http_url ? data.repository.git_http_url : data.project.http_url,
    html_url: data.repository.homepage,
    default_branch: data.project.default_branch,
    name: data.repository.name,
    full_name: data.project.path_with_namespace,
    description: data.repository.description,
    private: data.repository.visibility_level > 0 ? false : true,
    fork: data.repository.fork,
    user_login: data.user_username ? data.user_username : data.user.username,
    user_id: data.user_id ? data.user_id : data.object_attributes.author_id,
    user_avatar_url: data.user_avatar ? data.user_avatar : data.user.avatar_url,
    repository_provider: 'gitlab',
    api_url: apiUrl,
    data: data
  };
}

function generateGogsRepositoryData(data: any): any {
  let url = new URL(data.repository.clone_url);
  let apiUrl = url.protocol + '//' + url.host;

  return {
    gogs_id: data.repository.id,
    clone_url: data.repository.clone_url,
    html_url: data.repository.html_url,
    default_branch: data.repository.default_branch,
    name: data.repository.name,
    full_name: data.repository.full_name,
    description: data.repository.description,
    private: data.repository.private,
    fork: data.repository.fork,
    user_login: data.repository.owner.login,
    user_id: data.repository.owner.id,
    user_avatar_url: data.repository.owner.avatar_url,
    repository_provider: 'gogs',
    api_url: apiUrl,
    data: data
  };
}
