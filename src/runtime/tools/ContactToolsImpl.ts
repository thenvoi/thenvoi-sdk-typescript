import { UnsupportedFeatureError, ValidationError } from "../../core/errors";
import type { ContactRestApi } from "../../client/rest/types";
import { DEFAULT_REQUEST_OPTIONS } from "../../client/rest/requestOptions";
import type {
  AddContactArgs,
  ContactRecord,
  ContactRequestsResult,
  ListContactRequestsArgs,
  ListContactsArgs,
  PaginatedList,
  RemoveContactArgs,
  RespondContactRequestArgs,
  ToolOperationResult,
} from "../../contracts/dtos";
import type { ContactTools } from "../../contracts/protocols";

export class ContactToolsImpl implements ContactTools {
  private readonly rest: ContactRestApi;

  public constructor(rest: ContactRestApi) {
    this.rest = rest;
  }

  public async listContacts(request: ListContactsArgs = {}): Promise<PaginatedList<ContactRecord>> {
    if (!this.rest.listContacts) {
      throw new UnsupportedFeatureError("Contact listing is not available in current REST adapter");
    }

    return this.rest.listContacts(
      {
        page: request.page ?? 1,
        pageSize: request.pageSize ?? 50,
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async addContact(request: AddContactArgs): Promise<ToolOperationResult> {
    if (!this.rest.addContact) {
      throw new UnsupportedFeatureError("Contact creation is not available in current REST adapter");
    }

    const normalizedHandle = request.handle.trim();
    if (normalizedHandle.length === 0) {
      throw new ValidationError("handle is required");
    }

    return this.rest.addContact(
      {
        handle: normalizedHandle,
        ...(request.message ? { message: request.message } : {}),
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async removeContact(request: RemoveContactArgs): Promise<ToolOperationResult> {
    if (!this.rest.removeContact) {
      throw new UnsupportedFeatureError("Contact removal is not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.removeContact(
        { target: "handle", handle },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const contactId = request.contactId.trim();
    if (contactId.length === 0) {
      throw new ValidationError("contactId is required");
    }

    return this.rest.removeContact(
      { target: "contactId", contactId },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async listContactRequests(
    request: ListContactRequestsArgs = {},
  ): Promise<ContactRequestsResult> {
    if (!this.rest.listContactRequests) {
      throw new UnsupportedFeatureError("Contact request listing is not available in current REST adapter");
    }

    return this.rest.listContactRequests(
      {
        page: request.page ?? 1,
        pageSize: request.pageSize ?? 50,
        sentStatus: request.sentStatus ?? "pending",
      },
      DEFAULT_REQUEST_OPTIONS,
    );
  }

  public async respondContactRequest(request: RespondContactRequestArgs): Promise<ToolOperationResult> {
    if (!this.rest.respondContactRequest) {
      throw new UnsupportedFeatureError("Contact request responses are not available in current REST adapter");
    }

    if (request.target === "handle") {
      const handle = request.handle.trim();
      if (handle.length === 0) {
        throw new ValidationError("handle is required");
      }

      return this.rest.respondContactRequest(
        { action: request.action, target: "handle", handle },
        DEFAULT_REQUEST_OPTIONS,
      );
    }

    const requestId = request.requestId.trim();
    if (requestId.length === 0) {
      throw new ValidationError("requestId is required");
    }

    return this.rest.respondContactRequest(
      { action: request.action, target: "requestId", requestId },
      DEFAULT_REQUEST_OPTIONS,
    );
  }
}
