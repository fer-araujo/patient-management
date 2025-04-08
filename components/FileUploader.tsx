"use client";

import Image from "next/image";
import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { X } from "lucide-react";

import { convertFileToUrl } from "@/lib/utils";

type FileUploaderProps = {
  files: File[] | undefined;
  onChange: (files: File[]) => void;
};

export const FileUploader = ({ files = [], onChange }: FileUploaderProps) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      onChange([...files, ...acceptedFiles]);
    },
    [files, onChange]
  );

  const removeFile = (indexToRemove: number) => {
    const updatedFiles = files.filter((_, i) => i !== indexToRemove);
    onChange(updatedFiles);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    multiple: true,
    accept: {
      "image/jpeg": [],
      "image/png": [],
      "application/pdf": [],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  return (
    <div {...getRootProps()} className="file-upload">
      <input {...getInputProps()} />
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-4 justify-start w-full">
          {files.map((file, index) => (
            <div key={index} className="relative">
              <Image
                src={convertFileToUrl(file)}
                width={1000}
                height={1000}
                alt={`uploaded file ${index + 1}`}
                className="max-h-[125px] w-auto object-cover rounded-md"
              />
              <button
                type="button"
                className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-1"
                onClick={(e) => {
                  e.stopPropagation(); // Evita que abra el file picker
                  removeFile(index);
                }}
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Image
            src="/assets/icons/upload.svg"
            width={40}
            height={40}
            alt="upload"
          />
          <div className="file-upload_label">
            <p className="text-sm">
              <span className="text-green-500">Haz click para subir tus estudios </span>
              o arrastra los archivos aquí
            </p>
            <p className="text-xs text-dark-600">
              JPG, PNG o PDF (máx. 50MB por archivo)
            </p>
          </div>
        </>
      )}
    </div>
  );
};
