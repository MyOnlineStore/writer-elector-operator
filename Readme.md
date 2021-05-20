# writer-elector-operator
K8s operator for creating a single writer Endpoint from a Kubernetes Endpoints resource.

# Annotations

| Annotation | Description | Default |
| --- | --- | --- |
| `writer-elector.myonlinestore.com/elector` | There are some specific election handlers for certain protocols. One of: `default`, `postgres` | `default` |
| `writer-elector.myonlinestore.com/writer-create` | Create writer service | `true` |
| `writer-elector.myonlinestore.com/writer-service-name` | Name of the writer service that will be created | `{name}-writer` |
| `writer-elector.myonlinestore.com/reader-create` | Create reader service | `false` |
| `writer-elector.myonlinestore.com/reader-service-name` | Name of the reader service that will be created | `{name}-reader` |
| `writer-elector.myonlinestore.com/read-from-writer` | Include the elected writer in the reader service | `true` |
| `writer-elector.myonlinestore.com/secret-name` | Name of a secret in the same namespace to use for authentication of certain protocols | |

## `default` election handler

The `default` election handler will elect the first ready endpoint as writer and only failover when it becomes not ready. If the `create-reader` annotation is set, a service will be created with all ready endpoints.

## `postgres` election handler

The `postgres` election handler will elect the first postgres pod as writer, for which is ready and has the `transaction_read_only` variable set to `false`. If the `create-reader` annotation is set, a service will be created with all ready endpoints.

### `postgres` extra annotations
| Annotation | Description | Default |
| --- | --- | --- |
| `writer-elector.myonlinestore.com/secret-postgres-username` | The key inside the Secret that contains the postgres username. | `POSTGRES_USERNAME` |
| `writer-elector.myonlinestore.com/secret-postgres-password` | The key inside the Secret that contains the postgres password. | `POSTGRES_PASSWORD` |