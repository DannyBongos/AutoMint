"use client";

import Modal from "./Modal";
import clsx from "clsx";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
}

function ConfirmDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description}>
      <div className="flex gap-3 mt-6">
        <button
          onClick={onConfirm}
          className={clsx(
            "flex-1 rounded-lg px-4 py-2 text-semibold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "bg-gold/10 text-gold border-gold/30 hover:bg-gold/20 hover:border-gold/50"
          )}
          disabled={false}
        >
          {confirmText}
        </button>
        <button
          onClick={onClose}
          className={clsx(
            "flex-1 rounded-lg px-4 py-2 text-semibold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "text-muted hover:text-text hover:bg-card-2"
          )}
          disabled={false}
        >
          {cancelText}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
