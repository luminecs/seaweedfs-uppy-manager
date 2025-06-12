<!-- src/views/Upload.vue -->
<template>
  <div class="bg-white p-6 rounded-lg shadow-lg">
    <h1 class="text-2xl font-bold mb-4">Uppy S3 Multipart Upload Test</h1>
    <p class="text-gray-600 mb-4">
      在这里上传的文件需要手动指定 Bucket。
    </p>

    <div class="mb-4">
      <label for="bucket-name" class="block text-sm font-medium text-gray-700">Bucket Name</label>
      <input
        type="text"
        v-model="bucketName"
        id="bucket-name"
        placeholder="Enter bucket name before adding files"
        class="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
      />
    </div>

    <!-- uppy 实例现在是稳定的，我们可以在模板中安全地使用它 -->
    <Dashboard v-if="uppy" :uppy="uppy" :props="{ theme: 'light', proudllyDisplayPoweredByUppy: false }" />

    <div v-if="uploadStats.inProgress" class="mt-4 p-4 border rounded-md bg-gray-50">
      <h3 class="font-semibold text-lg">Upload Statistics</h3>
      <p>Progress: {{ uploadStats.progress.toFixed(2) }}%</p>
      <p>Uploaded: {{ formatBytes(uploadStats.bytesUploaded) }} / {{ formatBytes(uploadStats.bytesTotal) }}</p>
      <p>Speed: <span class="font-mono">{{ formatBytes(uploadStats.speed) }}/s</span></p>
      <p>Time Elapsed: {{ (uploadStats.elapsedTime / 1000).toFixed(2) }}s</p>
    </div>

    <div v-if="uploadStats.isComplete" class="mt-4 p-4 border rounded-md bg-green-50 text-green-800">
      <h3 class="font-semibold text-lg">Upload Complete!</h3>
      <p>Total time: {{ (uploadStats.totalTime / 1000).toFixed(2) }}s</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive } from 'vue';
import { Dashboard } from '@uppy/vue';
import Uppy from '@uppy/core';
import AwsS3Multipart from '@uppy/aws-s3-multipart';
import { s3Client } from '../s3Client';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3";

// uppy 实例只会被创建一次
const uppy = ref(null);
const bucketName = ref('');

const uploadStats = reactive({
  inProgress: false,
  isComplete: false,
  progress: 0,
  bytesUploaded: 0,
  bytesTotal: 0,
  speed: 0,
  startTime: 0,
  elapsedTime: 0,
  totalTime: 0,
});

// Helper to format bytes
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

onMounted(() => {
  // 只在 onMounted 中创建一次 Uppy 实例
  uppy.value = new Uppy({
    autoProceed: false, // 让用户可以一次性添加多个文件后手动开始
    debug: true, // 在开发时打开 debug 模式，便于观察
    restrictions: {
      maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
    },
    // 核心修改：在文件添加前，将 bucketName 存入文件的 meta 数据
    onBeforeFileAdded: (currentFile) => {
      if (!bucketName.value) {
        uppy.value.info('Please enter a bucket name before adding files.', 'error', 5000);
        return false;
      }
      // 将 bucketName 附加到每个文件的 meta 数据中
      currentFile.meta = {
        ...currentFile.meta,
        bucket: bucketName.value,
      };
      return true;
    },
  }).use(AwsS3Multipart, {
    // 核心修改：在这些函数中，从 file.meta 中读取 bucket 名称
    createMultipartUpload: async (file) => {
      const command = new CreateMultipartUploadCommand({
        Bucket: file.meta.bucket, // 从 meta 读取
        Key: file.name,
        ContentType: file.type,
      });
      const data = await s3Client.send(command);
      return { uploadId: data.UploadId, key: data.Key };
    },
    listParts: async (file, { uploadId, key }) => {
      const command = new ListPartsCommand({
        Bucket: file.meta.bucket, // 从 meta 读取
        Key: key,
        UploadId: uploadId,
      });
      const data = await s3Client.send(command);
      return (data.Parts || []).map(part => ({
        PartNumber: part.PartNumber,
        ETag: part.ETag,
        Size: part.Size,
      }));
    },
    uploadPart: async (file, part) => {
      const command = new UploadPartCommand({
        Bucket: file.meta.bucket, // 从 meta 读取
        Key: part.key,
        UploadId: part.uploadId,
        PartNumber: part.partNumber,
        Body: part.body,
      });
      const resp = await s3Client.send(command);
      return { etag: resp.ETag };
    },
    abortMultipartUpload: async (file, { uploadId, key }) => {
      const command = new AbortMultipartUploadCommand({
        Bucket: file.meta.bucket, // 从 meta 读取
        Key: key,
        UploadId: uploadId,
      });
      await s3Client.send(command);
    },
    completeMultipartUpload: async (file, { uploadId, key, parts }) => {
      const command = new CompleteMultipartUploadCommand({
        Bucket: file.meta.bucket, // 从 meta 读取
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map(({ partNumber, etag }) => ({
            PartNumber: partNumber,
            ETag: etag,
          })),
        },
      });
      const data = await s3Client.send(command);
      return { location: data.Location };
    },
  });

  // Event Listeners for Statistics (这些逻辑不变)
  uppy.value.on('upload-start', (files) => {
    uploadStats.inProgress = true;
    uploadStats.isComplete = false;
    uploadStats.startTime = Date.now();
    uploadStats.elapsedTime = 0;
  });

  uppy.value.on('progress', (progress) => {
    const state = uppy.value.getState();
    uploadStats.progress = state.totalProgress.progress;
    uploadStats.bytesUploaded = state.totalProgress.bytesUploaded;
    uploadStats.bytesTotal = state.totalProgress.bytesTotal;
    uploadStats.elapsedTime = Date.now() - uploadStats.startTime;
    uploadStats.speed = uploadStats.elapsedTime > 0 ? uploadStats.bytesUploaded / (uploadStats.elapsedTime / 1000) : 0;
  });

  uppy.value.on('complete', (result) => {
    uploadStats.inProgress = false;
    if (result.successful.length > 0) {
      uploadStats.isComplete = true;
      uploadStats.totalTime = Date.now() - uploadStats.startTime;
    }
  });

  uppy.value.on('cancel-all', () => {
    uploadStats.inProgress = false;
    uploadStats.isComplete = false;
  });
});

// onUnmounted 现在是安全的，因为 uppy.value 不会再被意外修改
onUnmounted(() => {
  if (uppy.value) {
    uppy.value.close();
  }
});

</script>
