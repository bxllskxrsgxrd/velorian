export type AttachmentLimits = {
	maxAttachments: number;
	maxFileSize: number;
	maxTotalSize: number;
};

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
	maxAttachments: 10,
	maxFileSize: 10 * 1024 * 1024,
	maxTotalSize: 25 * 1024 * 1024,
};

export const MAX_ATTACHMENTS = DEFAULT_ATTACHMENT_LIMITS.maxAttachments;

let runtimeAttachmentLimits = DEFAULT_ATTACHMENT_LIMITS;

export function configureAttachmentLimits(limits: AttachmentLimits) {
	if (limits.maxAttachments < 1 || limits.maxFileSize < 1 || limits.maxTotalSize < 1) return;
	runtimeAttachmentLimits = limits;
}

export function getAttachmentLimits(): AttachmentLimits {
	return runtimeAttachmentLimits;
}
