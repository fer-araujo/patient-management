import React from "react";
import clsx from "clsx";
import Image from "next/image";
import { StatusIcon } from "@/constants";
import { Status } from "@/types";
const StatusBadge = ({ status }: { status: Status }) => {
  let type;
  switch (status) {
    case "scheduled":
      type = "Agendada";
      break;
    case "cancelled":
      type = "Cancelada";
      break;
    case "rescheduled":
      type = "Pendiente";
      break;
    case "denied":
      type = "Rechazada";
      break;
    default:
      type = "Pendiente";
  }
  return (
    <div
      className={clsx("status-badge", {
        "bg-green-600": status === "scheduled",
        "bg-blue-600": status === "pending" || status === "rescheduled",
        "bg-red-600": status === "cancelled" || status === "denied",
      })}
    >
      <Image
        src={StatusIcon[status]}
        height={25}
        width={25}
        alt={status}
        className=" w-4"
      />
      <p className={clsx('text-regular font-medium capitalize', {
        'text-green-500': status === "scheduled",
        'text-blue-500': status === "pending" || status === "rescheduled",
        'text-red-500': status === "cancelled" || status === "denied",
      })}>{type}</p>
    </div>
  );
};

export default StatusBadge;
