package temporaladapter

import (
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// RegisterWorkflows registers the deterministic workflows under their stable
// names. Registration validates the workflow signatures, so a signature drift
// fails at startup rather than at the first job.
func RegisterWorkflows(reg worker.WorkflowRegistry) {
	reg.RegisterWorkflowWithOptions(workflows.CreateHostWorkflow, workflow.RegisterOptions{
		Name: workflows.CreateHostWorkflowName,
	})
	reg.RegisterWorkflowWithOptions(workflows.DeleteHostWorkflow, workflow.RegisterOptions{
		Name: workflows.DeleteHostWorkflowName,
	})
}

// RegisterActivitySet registers each activity under the name the workflows use.
// Explicit names keep the workflow package as the single source of truth.
func RegisterActivitySet(reg worker.ActivityRegistry, acts *Activities) {
	reg.RegisterActivityWithOptions(acts.CreateHostResource, activity.RegisterOptions{Name: workflows.ActivityCreateHostResource})
	reg.RegisterActivityWithOptions(acts.CheckSSMAgent, activity.RegisterOptions{Name: workflows.ActivityCheckSSMAgent})
	reg.RegisterActivityWithOptions(acts.EnrollHost, activity.RegisterOptions{Name: workflows.ActivityEnrollHost})
	reg.RegisterActivityWithOptions(acts.DeployProfile, activity.RegisterOptions{Name: workflows.ActivityDeployProfile})
	reg.RegisterActivityWithOptions(acts.ReadBackProfile, activity.RegisterOptions{Name: workflows.ActivityReadBackProfile})
	reg.RegisterActivityWithOptions(acts.AuthorizeHost, activity.RegisterOptions{Name: workflows.ActivityAuthorizeHost})
	reg.RegisterActivityWithOptions(acts.RevokeHostTokens, activity.RegisterOptions{Name: workflows.ActivityRevokeHostTokens})
	reg.RegisterActivityWithOptions(acts.RevokeHostCredentials, activity.RegisterOptions{Name: workflows.ActivityRevokeHostCredentials})
	reg.RegisterActivityWithOptions(acts.RemoveDevice, activity.RegisterOptions{Name: workflows.ActivityRemoveDevice})
	reg.RegisterActivityWithOptions(acts.DestroyHostResource, activity.RegisterOptions{Name: workflows.ActivityDestroyHostResource})
	reg.RegisterActivityWithOptions(acts.RecordHostMilestone, activity.RegisterOptions{Name: workflows.ActivityRecordHostMilestone})
}

// NewWorker builds a bounded worker. Concurrency limits are enforced here so a
// burst of API calls cannot fan out unbounded Terraform, SSM, or provider work.
func NewWorker(c client.Client, taskQueue string, options worker.Options, acts *Activities) (worker.Worker, error) {
	if err := acts.Validate(); err != nil {
		return nil, err
	}
	w := worker.New(c, taskQueue, options)
	RegisterWorkflows(w)
	RegisterActivitySet(w, acts)
	return w, nil
}
