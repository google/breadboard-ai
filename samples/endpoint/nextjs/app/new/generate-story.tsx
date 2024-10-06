/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { useEffect, useState } from "react";
import Form from "./form";
import { StoryMakingProgress, StoryMakingState } from "../types";
import { chunkRepairTransform } from "./chunk-repair";
import Link from "next/link";

export default function GenerateStory() {
  const [state, setState] = useState<StoryMakingState>("idle");
  const [progress, setProgress] = useState<StoryMakingProgress[]>([]);
  const [form, setForm] = useState<FormData | null>(null);

  useEffect(() => {
    async function startFetching() {
      try {
        const result = await fetch("/api/create", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(form!.entries())),
          headers: {
            "Content-Type": "application/json",
          },
        });
        if (!result.ok) {
          setProgress((progress) => [
            ...progress,
            { type: "error", error: `${result.status} ${result.statusText}` },
          ]);
        }
        result.body
          ?.pipeThrough(new TextDecoderStream())
          .pipeThrough(chunkRepairTransform())
          .pipeThrough(serverStreamEventDecoder())
          .pipeTo(
            new WritableStream({
              write(chunk) {
                const json = JSON.parse(chunk);
                setProgress((progress) => [...progress, json]);
              },
              close() {
                setState("done");
              },
            })
          );
      } catch (error) {
        // TODO: Handle error
        console.error(error);
        setState("error");
      }
    }
    if (state == "starting" && form) {
      setState("creating");
      startFetching();
    }
  }, [state, form]);

  if (progress.length > 0) {
    return (
      <section className="grid grid-cols-6 gap-5">
        {progress.map((event, i) => {
          switch (event.type) {
            case "rejected":
              return (
                <h2 key={i} className="font-bold">
                  Story Rejected
                </h2>
              );
            case "error":
              return (
                <h2 key={i} className="col-span-6 text-red-500">
                  Error: {event.error}
                </h2>
              );
            case "start":
              return (
                <h2 key={i} className="col-span-6">
                  {event.title}
                </h2>
              );
            case "chapter":
              return (
                <div key={i}>
                  <img
                    className="block rounded-full bg-gradient-to-r from-slate-100 to-slate-200"
                    width="100"
                    height="100"
                    src={event.chapter.img}
                    alt={event.chapter.text}
                  />
                </div>
              );
            case "done":
              return (
                <div className="col-span-6">
                  <h2>Story Created</h2>
                  <Link
                    href={`/story/${event.id}`}
                    className="inline-block mt-5 py-2 px-4 border-2 rounded-full hover:bg-fuchsia-100"
                  >
                    Read Story
                  </Link>
                </div>
              );
          }
        })}
        {state === "creating" && (
          <div
            style={{ width: "100px", height: "100px" }}
            className="block rounded-full bg-gradient-to-r from-slate-100 to-slate-200 animate-pulse"
          ></div>
        )}
      </section>
    );
  }

  return (
    <>
      <h2 className="font-bold">Tell a New Story</h2>
      <p className="pt-5 text-slate-400">
        Enter the topic around which to build the story. It can be short like
        "the old clock" or long. The Story Teller will use it as inspiration.
      </p>
      <Form
        onSubmit={(data: FormData) => {
          setState("starting");
          setForm(data);
        }}
      ></Form>
    </>
  );
}

function serverStreamEventDecoder() {
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      if (chunk.startsWith("data: ")) {
        controller.enqueue(chunk.slice(6));
      }
    },
  });
}
